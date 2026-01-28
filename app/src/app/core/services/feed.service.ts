import { Injectable, inject, signal, computed, DestroyRef, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Firestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { RemoteConfigService } from './remote-config.service';
import {
  Post,
  PostDisplay,
  FeedItem,
  CommentDisplay,
  CreatePostRequest,
  CreatePostResponse,
  GetCommentsResponse,
  PostVisibility,
  FeedFilter,
  PostContent,
  ReputationTier,
  PostSource,
} from '../interfaces';

const PAGE_SIZE = 20;

@Injectable({
  providedIn: 'root',
})
export class FeedService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly remoteConfigService = inject(RemoteConfigService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // Active subscriptions
  private exploreFeedUnsubscribe: (() => void) | null = null;
  private homeFeedUnsubscribe: (() => void) | null = null;

  // Cache for current user's regionId to avoid repeated fetches
  private cachedRegionId: string | null = null;

  // Caches to avoid refetching data we already have
  private likeStatusCache = new Map<string, boolean>(); // postId -> isLiked
  private authorDataCache = new Map<string, Record<string, unknown>>(); // authorId -> public data
  // Note: We don't cache private data - security rules block reading other users' private docs
  // reputationTier is available on the public user document
  private blockedAuthorsCache: Set<string> | null = null; // Set of blocked author IDs

  // Feed state
  private readonly _posts = signal<PostDisplay[]>([]);
  private readonly _allPosts = signal<PostDisplay[]>([]); // Unfiltered posts for client-side filtering
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _hasMore = signal(true);
  private readonly _activeFilter = signal<FeedFilter>('all');
  private lastVisibleDoc: DocumentSnapshot | null = null;
  private lastHomeFeedDoc: DocumentSnapshot | null = null;

  // Comments state
  private readonly _comments = signal<CommentDisplay[]>([]);
  private readonly _commentsLoading = signal(false);
  private readonly _commentsError = signal<string | null>(null);
  private readonly _commentsCursor = signal<string | null>(null);
  private readonly _commentsHasMore = signal(true);
  private readonly _currentPostId = signal<string | null>(null);
  private commentsUnsubscribe: (() => void) | null = null;
  private postUnsubscribe: (() => void) | null = null;

  // Post creation state
  private readonly _creating = signal(false);
  private readonly _createError = signal<string | null>(null);

  // Post deletion state
  private readonly _deletingPostId = signal<string | null>(null);
  private deletedPostIds = new Set<string>(); // Track deleted posts to filter from subscriptions

  // Public signals
  readonly posts = this._posts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();

  readonly comments = this._comments.asReadonly();
  readonly commentsLoading = this._commentsLoading.asReadonly();
  readonly commentsError = this._commentsError.asReadonly();
  readonly commentsHasMore = this._commentsHasMore.asReadonly();

  readonly creating = this._creating.asReadonly();
  readonly createError = this._createError.asReadonly();
  readonly deletingPostId = this._deletingPostId.asReadonly();

  // Feature flag
  readonly feedEnabled = this.remoteConfigService.featureFeedEnabled;

  // Filter options for the UI
  readonly filterOptions: { value: FeedFilter; labelKey: string; icon: string }[] = [
    { value: 'all', labelKey: 'FEED.FILTER_ALL', icon: 'public' },
    { value: 'connections', labelKey: 'FEED.FILTER_CONNECTIONS', icon: 'people' },
    { value: 'private', labelKey: 'FEED.FILTER_PRIVATE', icon: 'lock' },
  ];

  // Computed
  readonly isEmpty = computed(() => !this._loading() && this._posts().length === 0);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Subscribe to unified feed (public + connections + private)
   * All posts are fetched, then client-side filtered based on activeFilter
   */
  subscribeToFeed(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const user = this.authService.user();
    if (!user) return;

    // Cleanup existing subscriptions
    this.unsubscribeFromFeeds();
    this._loading.set(true);
    this._error.set(null);
    this._hasMore.set(true);
    this.lastVisibleDoc = null;
    this.lastHomeFeedDoc = null;

    // Use cached regionId if available, otherwise fetch
    this.getRegionId(user.uid).then((regionId) => {
      if (!regionId) {
        this._error.set('Please complete your profile to view the feed.');
        this._loading.set(false);
        return;
      }

      // Subscribe to public posts in user's region
      const postsRef = collection(this.firestore, 'posts');
      const publicQuery = query(
        postsRef,
        where('regionId', '==', regionId),
        where('visibility', '==', 'public'),
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      // Subscribe to user's feedItems (connections + private)
      const feedItemsRef = collection(this.firestore, 'users', user.uid, 'feedItems');
      const feedItemsQuery = query(
        feedItemsRef,
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      let publicPosts: PostDisplay[] = [];
      let homePosts: PostDisplay[] = [];
      let publicLoaded = false;
      let homeLoaded = false;

      const mergeAndApplyFilter = () => {
        if (!publicLoaded || !homeLoaded) return;

        // Merge and deduplicate by post ID
        const allPostsMap = new Map<string, PostDisplay>();
        
        // Add public posts first
        publicPosts.forEach((post) => allPostsMap.set(post.id, post));
        
        // Add home posts, overwriting if duplicate (home has more context)
        homePosts.forEach((post) => allPostsMap.set(post.id, post));

        // Sort by createdAt descending and filter out deleted posts
        const allPosts = Array.from(allPostsMap.values())
          .filter((post) => !this.deletedPostIds.has(post.id))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        this._allPosts.set(allPosts);
        this.applyFilter();
        this._loading.set(false);
      };

      // Public posts subscription
      this.exploreFeedUnsubscribe = onSnapshot(
        publicQuery,
        async (snapshot) => {
          publicPosts = await this.processPosts(snapshot.docs, user.uid);
          this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1] || null;
          publicLoaded = true;
          mergeAndApplyFilter();
        },
        (error) => {
          console.error('Public feed subscription error:', error);
          publicLoaded = true;
          mergeAndApplyFilter();
        }
      );

      // Home feed subscription (connections + private)
      this.homeFeedUnsubscribe = onSnapshot(
        feedItemsQuery,
        async (snapshot) => {
          const feedItems = snapshot.docs.map((d) => ({
            ...(d.data() as FeedItem),
            _docSnap: d,
          }));

          if (feedItems.length > 0) {
            homePosts = await this.fetchPostsFromFeedItems(feedItems, user.uid);
            this.lastHomeFeedDoc = snapshot.docs[snapshot.docs.length - 1] || null;
          } else {
            homePosts = [];
          }
          homeLoaded = true;
          mergeAndApplyFilter();
        },
        (error) => {
          console.error('Home feed subscription error:', error);
          homeLoaded = true;
          mergeAndApplyFilter();
        }
      );
    }).catch((error) => {
      console.error('Failed to get user regionId:', error);
      this._error.set('Failed to load feed. Please try again.');
      this._loading.set(false);
    });
  }

  /**
   * Apply the current filter to the all posts collection
   */
  private applyFilter(): void {
    const allPosts = this._allPosts();
    const filter = this._activeFilter();

    if (filter === 'all') {
      this._posts.set(allPosts);
    } else if (filter === 'connections') {
      // Filter to only posts from connections (source === 'connection')
      const filtered = allPosts.filter((post) => post.source === 'connection');
      this._posts.set(filtered);
    } else if (filter === 'private') {
      // Filter to only private posts (source === 'private')
      const filtered = allPosts.filter((post) => post.source === 'private');
      this._posts.set(filtered);
    }
  }

  /**
   * Set the active filter and apply it
   */
  setFilter(filter: FeedFilter): void {
    if (this._activeFilter() === filter) return;
    this._activeFilter.set(filter);
    this.applyFilter();
  }

  /**
   * @deprecated Use subscribeToFeed() instead
   */
  subscribeToExploreFeed(): void {
    this.subscribeToFeed();
  }

  /**
   * Get user's regionId with caching
   */
  private async getRegionId(userId: string): Promise<string | null> {
    if (this.cachedRegionId) {
      return this.cachedRegionId;
    }

    const userRef = doc(this.firestore, 'users', userId);
    const userDoc = await getDoc(userRef);
    const regionId = userDoc.data()?.['regionId'] as string | undefined;

    if (regionId) {
      this.cachedRegionId = regionId;
    }

    return regionId || null;
  }

  /**
   * @deprecated Use subscribeToFeed() instead
   */
  subscribeToHomeFeed(): void {
    this.subscribeToFeed();
  }

  /**
   * Load more posts (pagination)
   * TODO: Implement proper pagination for unified feed
   */
  async loadMore(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const user = this.authService.user();
    if (!user || !this._hasMore() || this._loadingMore()) return;

    // For now, we only paginate public posts since home feed items are limited
    if (!this.lastVisibleDoc) return;

    this._loadingMore.set(true);

    try {
      await this.loadMoreExplorePosts(user.uid);
    } catch (error) {
      console.error('Failed to load more posts:', error);
    } finally {
      this._loadingMore.set(false);
    }
  }

  private async loadMoreExplorePosts(userId: string): Promise<void> {
    const regionId = await this.getRegionId(userId);

    if (!regionId || !this.lastVisibleDoc) return;

    const postsRef = collection(this.firestore, 'posts');
    const q = query(
      postsRef,
      where('regionId', '==', regionId),
      where('visibility', '==', 'public'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      startAfter(this.lastVisibleDoc),
      limit(PAGE_SIZE)
    );

    const snapshot = await getDocs(q);
    const newPosts = await this.processPosts(snapshot.docs, userId);
    
    this._posts.update((posts) => [...posts, ...newPosts]);
    this._hasMore.set(snapshot.docs.length === PAGE_SIZE);
    this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1] || this.lastVisibleDoc;
  }

  private async loadMoreHomePosts(userId: string): Promise<void> {
    if (!this.lastVisibleDoc) return;

    const feedItemsRef = collection(this.firestore, 'users', userId, 'feedItems');
    const q = query(
      feedItemsRef,
      orderBy('createdAt', 'desc'),
      startAfter(this.lastVisibleDoc),
      limit(PAGE_SIZE)
    );

    const snapshot = await getDocs(q);
    const feedItems = snapshot.docs.map((doc) => doc.data() as FeedItem);

    if (feedItems.length > 0) {
      const newPosts = await this.fetchPostsFromFeedItems(feedItems, userId);
      this._posts.update((posts) => [...posts, ...newPosts]);
    }

    this._hasMore.set(snapshot.docs.length === PAGE_SIZE);
    this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1] || this.lastVisibleDoc;
  }

  /**
   * Process raw post documents into PostDisplay objects
   * Optimized with caching to avoid refetching data we already have
   */
  private async processPosts(
    docs: QueryDocumentSnapshot[],
    currentUserId: string,
    source: PostSource = 'public'
  ): Promise<PostDisplay[]> {
    if (docs.length === 0) return [];

    // Collect unique author IDs and post IDs
    const authorIds = [...new Set(docs.map((d) => (d.data() as Post).authorId))];
    const postIds = docs.map((d) => d.id);

    // Determine what we need to fetch (not in cache)
    const uncachedAuthorIds = authorIds.filter((uid) => !this.authorDataCache.has(uid));
    const uncachedPostIds = postIds.filter((postId) => !this.likeStatusCache.has(postId));

    // Build parallel fetch promises only for uncached data
    const fetchPromises: Promise<unknown>[] = [];

    // Fetch uncached author public docs
    if (uncachedAuthorIds.length > 0) {
      fetchPromises.push(
        Promise.all(
          uncachedAuthorIds.map((uid) => getDoc(doc(this.firestore, 'users', uid)))
        ).then((authorDocs) => {
          uncachedAuthorIds.forEach((uid, i) => {
            this.authorDataCache.set(uid, authorDocs[i].data() || {});
          });
        })
      );
      // Note: We don't fetch private data for other users - security rules block it
      // Instead, we use reputationTier from the public user document
    }

    // Fetch uncached like statuses
    if (uncachedPostIds.length > 0) {
      fetchPromises.push(
        Promise.all(
          uncachedPostIds.map((postId) =>
            getDoc(doc(this.firestore, 'posts', postId, 'likes', currentUserId))
          )
        ).then((likeDocs) => {
          uncachedPostIds.forEach((postId, i) => {
            this.likeStatusCache.set(postId, likeDocs[i].exists());
          });
        })
      );
    }

    // Fetch blocked authors if not cached
    if (this.blockedAuthorsCache === null) {
      fetchPromises.push(
        this.fetchBlockedAuthors(currentUserId).then((blocked) => {
          this.blockedAuthorsCache = blocked;
        })
      );
    }

    // Wait for all fetches to complete
    await Promise.all(fetchPromises);

    // Build posts array using cached data
    const posts: PostDisplay[] = [];

    for (const docSnap of docs) {
      const postData = docSnap.data() as Post;

      // Skip blocked authors (except own posts)
      if (
        this.blockedAuthorsCache?.has(postData.authorId) &&
        postData.authorId !== currentUserId
      ) {
        continue;
      }

      const authorData = this.authorDataCache.get(postData.authorId) || {};
      const createdAt = postData.createdAt as Timestamp;

      posts.push({
        id: docSnap.id,
        author: {
          uid: postData.authorId,
          displayName: (authorData['displayName'] as string) || null,
          photoURL: (authorData['photoURL'] as string) || null,
          // Use reputationTier from public user doc (not private data which has security rules)
          reputationTier: (authorData['reputationTier'] as ReputationTier) || undefined,
          isVerified: authorData['identityVerified'] as boolean,
        },
        content: postData.content,
        visibility: postData.visibility,
        likeCount: postData.metrics?.likeCount || 0,
        commentCount: postData.metrics?.commentCount || 0,
        isLiked: this.likeStatusCache.get(docSnap.id) || false,
        isOwn: postData.authorId === currentUserId,
        createdAt: createdAt?.toDate() || new Date(),
        status: postData.status,
        source,
      });
    }

    return posts;
  }

  /**
   * Fetch all blocked user IDs for the current user
   * This is called once per session and cached
   */
  private async fetchBlockedAuthors(currentUserId: string): Promise<Set<string>> {
    const blockedSet = new Set<string>();

    // Fetch users I blocked and users who blocked me in parallel
    const [blockedByMe, blockedMe] = await Promise.all([
      getDocs(collection(this.firestore, 'users', currentUserId, 'blocks')),
      getDocs(collection(this.firestore, 'users', currentUserId, 'blockedBy')),
    ]);

    blockedByMe.forEach((docSnap) => blockedSet.add(docSnap.id));
    blockedMe.forEach((docSnap) => blockedSet.add(docSnap.id));

    return blockedSet;
  }

  /**
   * Fetch full posts from feed items
   * Optimized with caching to avoid refetching data we already have
   */
  private async fetchPostsFromFeedItems(
    feedItems: FeedItem[],
    currentUserId: string
  ): Promise<PostDisplay[]> {
    if (feedItems.length === 0) return [];

    // Create a map from postId to FeedItem for source tracking
    const feedItemMap = new Map<string, FeedItem>();
    feedItems.forEach((fi) => feedItemMap.set(fi.postId, fi));

    const postIds = feedItems.map((fi) => fi.postId);

    // First, batch fetch all post documents
    const postDocs = await Promise.all(
      postIds.map((postId) => getDoc(doc(this.firestore, 'posts', postId)))
    );

    // Filter to valid, active posts
    const validPosts: Array<{ postId: string; postData: Post; feedItem: FeedItem }> = [];
    postDocs.forEach((postDoc, i) => {
      if (postDoc.exists()) {
        const postData = postDoc.data() as Post;
        const feedItem = feedItemMap.get(postIds[i]);
        if (postData.status === 'active' && feedItem) {
          validPosts.push({ postId: postIds[i], postData, feedItem });
        }
      }
    });

    if (validPosts.length === 0) return [];

    // Collect unique author IDs and valid post IDs
    const authorIds = [...new Set(validPosts.map((p) => p.postData.authorId))];
    const validPostIds = validPosts.map((p) => p.postId);

    // Determine what we need to fetch (not in cache)
    const uncachedAuthorIds = authorIds.filter((uid) => !this.authorDataCache.has(uid));
    const uncachedPostIds = validPostIds.filter((postId) => !this.likeStatusCache.has(postId));

    // Build parallel fetch promises only for uncached data
    const fetchPromises: Promise<unknown>[] = [];

    if (uncachedAuthorIds.length > 0) {
      fetchPromises.push(
        Promise.all(
          uncachedAuthorIds.map((uid) => getDoc(doc(this.firestore, 'users', uid)))
        ).then((authorDocs) => {
          uncachedAuthorIds.forEach((uid, i) => {
            this.authorDataCache.set(uid, authorDocs[i].data() || {});
          });
        })
      );
      // Note: We don't fetch private data for other users - security rules block it
      // Instead, we use reputationTier from the public user document
    }

    if (uncachedPostIds.length > 0) {
      fetchPromises.push(
        Promise.all(
          uncachedPostIds.map((postId) =>
            getDoc(doc(this.firestore, 'posts', postId, 'likes', currentUserId))
          )
        ).then((likeDocs) => {
          uncachedPostIds.forEach((postId, i) => {
            this.likeStatusCache.set(postId, likeDocs[i].exists());
          });
        })
      );
    }

    if (this.blockedAuthorsCache === null) {
      fetchPromises.push(
        this.fetchBlockedAuthors(currentUserId).then((blocked) => {
          this.blockedAuthorsCache = blocked;
        })
      );
    }

    await Promise.all(fetchPromises);

    // Build posts array using cached data
    const posts: PostDisplay[] = [];

    for (const { postId, postData, feedItem } of validPosts) {
      // Skip blocked authors (except own posts)
      if (
        this.blockedAuthorsCache?.has(postData.authorId) &&
        postData.authorId !== currentUserId
      ) {
        continue;
      }

      const authorData = this.authorDataCache.get(postData.authorId) || {};
      const createdAt = postData.createdAt as Timestamp;

      // Determine source based on the FeedItem's visibility
      const source: PostSource = feedItem.visibility === 'private' ? 'private' : 'connection';

      posts.push({
        id: postId,
        author: {
          uid: postData.authorId,
          displayName: (authorData['displayName'] as string) || null,
          photoURL: (authorData['photoURL'] as string) || null,
          // Use reputationTier from public user doc (not private data which has security rules)
          reputationTier: (authorData['reputationTier'] as ReputationTier) || undefined,
          isVerified: authorData['identityVerified'] as boolean,
        },
        content: postData.content,
        visibility: postData.visibility,
        likeCount: postData.metrics?.likeCount || 0,
        commentCount: postData.metrics?.commentCount || 0,
        isLiked: this.likeStatusCache.get(postId) || false,
        isOwn: postData.authorId === currentUserId,
        createdAt: createdAt?.toDate() || new Date(),
        status: postData.status,
        source,
      });
    }

    return posts;
  }

  /**
   * Unsubscribe from all feed subscriptions
   */
  private unsubscribeFromFeeds(): void {
    if (this.exploreFeedUnsubscribe) {
      this.exploreFeedUnsubscribe();
      this.exploreFeedUnsubscribe = null;
    }
    if (this.homeFeedUnsubscribe) {
      this.homeFeedUnsubscribe();
      this.homeFeedUnsubscribe = null;
    }
  }

  /**
   * Refresh the feed
   */
  refresh(): void {
    this.subscribeToFeed();
  }

  /**
   * Create a new post
   */
  async createPost(request: CreatePostRequest): Promise<CreatePostResponse> {
    if (!this.authService.user()) {
      return { success: false, error: 'Must be logged in to create post' };
    }

    this._creating.set(true);
    this._createError.set(null);

    try {
      const createPostFn = httpsCallable<CreatePostRequest, CreatePostResponse>(
        this.functions,
        'createPost'
      );

      const result = await createPostFn(request);

      // Feed will update automatically via subscription
      return result.data;
    } catch (err) {
      console.error('Failed to create post:', err);
      const error = 'Failed to create post. Please try again.';
      this._createError.set(error);
      return { success: false, error };
    } finally {
      this._creating.set(false);
    }
  }

  /**
   * Like a post
   */
  async likePost(postId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    // Optimistic update - both state and cache
    this.likeStatusCache.set(postId, true);
    this._posts.update((posts) =>
      posts.map((post) =>
        post.id === postId
          ? { ...post, isLiked: true, likeCount: post.likeCount + 1 }
          : post
      )
    );

    try {
      const likePostFn = httpsCallable<{ postId: string }, { success: boolean }>(
        this.functions,
        'likePost'
      );

      await likePostFn({ postId });
      return true;
    } catch (err) {
      console.error('Failed to like post:', err);

      // Revert optimistic update - both state and cache
      this.likeStatusCache.set(postId, false);
      this._posts.update((posts) =>
        posts.map((post) =>
          post.id === postId
            ? { ...post, isLiked: false, likeCount: post.likeCount - 1 }
            : post
        )
      );
      return false;
    }
  }

  /**
   * Unlike a post
   */
  async unlikePost(postId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    // Optimistic update - both state and cache
    this.likeStatusCache.set(postId, false);
    this._posts.update((posts) =>
      posts.map((post) =>
        post.id === postId
          ? { ...post, isLiked: false, likeCount: Math.max(0, post.likeCount - 1) }
          : post
      )
    );

    try {
      const unlikePostFn = httpsCallable<{ postId: string }, { success: boolean }>(
        this.functions,
        'unlikePost'
      );

      await unlikePostFn({ postId });
      return true;
    } catch (err) {
      console.error('Failed to unlike post:', err);

      // Revert optimistic update - both state and cache
      this.likeStatusCache.set(postId, true);
      this._posts.update((posts) =>
        posts.map((post) =>
          post.id === postId
            ? { ...post, isLiked: true, likeCount: post.likeCount + 1 }
            : post
        )
      );
      return false;
    }
  }

  /**
   * Toggle like on a post
   */
  async toggleLike(post: PostDisplay): Promise<boolean> {
    if (post.isLiked) {
      return this.unlikePost(post.id);
    } else {
      return this.likePost(post.id);
    }
  }

  /**
   * Delete a post
   */
  async deletePost(postId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    this._deletingPostId.set(postId);

    try {
      const deletePostFn = httpsCallable<{ postId: string }, { success: boolean }>(
        this.functions,
        'deletePost'
      );

      await deletePostFn({ postId });

      // Add to deleted set so subscriptions filter it out
      this.deletedPostIds.add(postId);

      // Remove from BOTH local states
      this._posts.update((posts) => posts.filter((post) => post.id !== postId));
      this._allPosts.update((posts) => posts.filter((post) => post.id !== postId));

      // Clear caches for this post
      this.likeStatusCache.delete(postId);

      return true;
    } catch (err) {
      console.error('Failed to delete post:', err);
      return false;
    } finally {
      this._deletingPostId.set(null);
    }
  }

  /**
   * Report a post
   */
  async reportPost(postId: string, reason?: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    try {
      const reportPostFn = httpsCallable<
        { postId: string; reason?: string },
        { success: boolean }
      >(this.functions, 'reportPost');

      await reportPostFn({ postId, reason });
      return true;
    } catch (err) {
      console.error('Failed to report post:', err);
      return false;
    }
  }

  /**
   * Subscribe to comments for a post (realtime)
   */
  subscribeToComments(postId: string): void {
    const user = this.authService.user();
    if (!user) return;

    // Cleanup any existing subscription
    this.unsubscribeFromComments();

    this._currentPostId.set(postId);
    this._commentsLoading.set(true);
    this._commentsError.set(null);
    this._comments.set([]);

    // Subscribe to comments collection
    const commentsRef = collection(this.firestore, 'posts', postId, 'comments');
    const commentsQuery = query(
      commentsRef,
      where('status', '==', 'active'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    this.commentsUnsubscribe = onSnapshot(
      commentsQuery,
      async (snapshot) => {
        const comments: CommentDisplay[] = [];

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const authorId = data['authorId'] as string;
          
          // Get author info from cache or fetch
          let authorData = this.authorDataCache.get(authorId);
          if (!authorData) {
            const authorDoc = await getDoc(doc(this.firestore, 'users', authorId));
            authorData = authorDoc.data() || {};
            this.authorDataCache.set(authorId, authorData);
          }

          const createdAt = data['createdAt'] as Timestamp;

          comments.push({
            id: docSnap.id,
            author: {
              uid: authorId,
              displayName: (authorData['displayName'] as string) || null,
              photoURL: (authorData['photoURL'] as string) || null,
              reputationTier: (authorData['reputationTier'] as ReputationTier) || undefined,
            },
            content: data['content'] as string,
            createdAt: createdAt?.toDate() || new Date(),
            isOwn: authorId === user.uid,
          });
        }

        this._comments.set(comments);
        this._commentsLoading.set(false);
      },
      (error) => {
        console.error('Comments subscription error:', error);
        this._commentsError.set('Failed to load comments');
        this._commentsLoading.set(false);
      }
    );

    // Also subscribe to the post document for realtime like/comment count updates
    this.postUnsubscribe = onSnapshot(
      doc(this.firestore, 'posts', postId),
      (docSnap) => {
        if (!docSnap.exists()) return;
        const postData = docSnap.data();
        const metrics = postData['metrics'] as { likeCount?: number; commentCount?: number } | undefined;
        
        // Update the post in our posts array with new metrics
        this._posts.update((posts) =>
          posts.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  likeCount: metrics?.likeCount ?? post.likeCount,
                  commentCount: metrics?.commentCount ?? post.commentCount,
                }
              : post
          )
        );
        
        // Also update in _allPosts
        this._allPosts.update((posts) =>
          posts.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  likeCount: metrics?.likeCount ?? post.likeCount,
                  commentCount: metrics?.commentCount ?? post.commentCount,
                }
              : post
          )
        );
      }
    );
  }

  /**
   * Unsubscribe from comments
   */
  private unsubscribeFromComments(): void {
    if (this.commentsUnsubscribe) {
      this.commentsUnsubscribe();
      this.commentsUnsubscribe = null;
    }
    if (this.postUnsubscribe) {
      this.postUnsubscribe();
      this.postUnsubscribe = null;
    }
  }

  /**
   * Load more comments (pagination) - kept for compatibility but may not be needed with realtime
   */
  async loadMoreComments(): Promise<void> {
    // With realtime subscription, we initially load up to 100 comments
    // For very popular posts, we could implement cursor-based pagination
    // but for now this is a no-op since we load enough initially
    console.log('loadMoreComments called - realtime subscription handles updates');
  }

  /**
   * Add a comment to a post
   */
  async addComment(postId: string, content: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    try {
      const addCommentFn = httpsCallable<
        { postId: string; content: string },
        { success: boolean; commentId?: string }
      >(this.functions, 'addComment');

      const result = await addCommentFn({ postId, content });
      // The realtime subscription will automatically pick up the new comment
      // and the post subscription will update the comment count
      return result.data.success;
    } catch (err) {
      console.error('Failed to add comment:', err);
      return false;
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(postId: string, commentId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    try {
      const deleteCommentFn = httpsCallable<
        { postId: string; commentId: string },
        { success: boolean }
      >(this.functions, 'deleteComment');

      await deleteCommentFn({ postId, commentId });

      // Update local state
      this._comments.update((comments) =>
        comments.filter((comment) => comment.id !== commentId)
      );

      // Update comment count in posts
      this._posts.update((posts) =>
        posts.map((post) =>
          post.id === postId
            ? { ...post, commentCount: Math.max(0, post.commentCount - 1) }
            : post
        )
      );

      return true;
    } catch (err) {
      console.error('Failed to delete comment:', err);
      return false;
    }
  }

  /**
   * Clear comments state
   */
  clearComments(): void {
    // Unsubscribe from realtime listeners
    this.unsubscribeFromComments();
    
    this._comments.set([]);
    this._currentPostId.set(null);
    this._commentsCursor.set(null);
    this._commentsHasMore.set(true);
  }

  /**
   * Cleanup
   */
  private cleanup(): void {
    this.unsubscribeFromFeeds();
    this.unsubscribeFromComments();
    this._posts.set([]);
    this._allPosts.set([]);
    this._comments.set([]);
    this._cursor.set(null);
    this._commentsCursor.set(null);
    this._activeFilter.set('all');
    this.cachedRegionId = null;
    this.lastVisibleDoc = null;
    this.lastHomeFeedDoc = null;
    // Clear all caches
    this.likeStatusCache.clear();
    this.authorDataCache.clear();
    this.blockedAuthorsCache = null;
  }

  // Legacy cursor (kept for compatibility)
  private readonly _cursor = signal<string | null>(null);
}
