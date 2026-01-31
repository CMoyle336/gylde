import { Injectable, inject, signal, computed, DestroyRef, PLATFORM_ID, effect, untracked } from '@angular/core';
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
  getCountFromServer,
  documentId,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { RemoteConfigService } from './remote-config.service';
import { BlockService } from './block.service';
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
const FILTER_STORAGE_KEY = 'gylde_feed_filter';
const TAB_STORAGE_KEY = 'gylde_feed_tab';
const SUBFILTER_STORAGE_KEY = 'gylde_feed_subfilter';

// Tab type for main navigation
export type FeedTab = 'feed' | 'private';

// Sub-filter type for the Feed tab (excludes 'private')
export type FeedSubFilter = 'all' | 'matches';

@Injectable({
  providedIn: 'root',
})
export class FeedService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly remoteConfigService = inject(RemoteConfigService);
  private readonly blockService = inject(BlockService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // Active feed subscription
  private feedUnsubscribe: (() => void) | null = null;
  
  // Feed stats subscription
  private feedStatsUnsubscribe: (() => void) | null = null;

  // Caches to avoid refetching data we already have
  private likeStatusCache = new Map<string, boolean>(); // postId -> isLiked
  private commentLikeStatusCache = new Map<string, boolean>(); // commentId -> isLiked
  private authorDataCache = new Map<string, Record<string, unknown>>(); // authorId -> public data
  // Note: We don't cache private data - security rules block reading other users' private docs
  // reputationTier is available on the public user document
  // Note: We use BlockService.blockedUserIds() for blocked authors - no local cache needed

  // Feed state
  private readonly _posts = signal<PostDisplay[]>([]);
  private readonly _allPosts = signal<PostDisplay[]>([]); // Unfiltered posts for client-side filtering
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _hasMore = signal(true);
  private readonly _activeFilter = signal<FeedFilter>(this.loadSavedFilter());
  private readonly _activeTab = signal<FeedTab>(this.loadSavedTab());
  private readonly _activeSubFilter = signal<FeedSubFilter>(this.loadSavedSubFilter());
  private lastVisibleDoc: DocumentSnapshot | null = null;

  // Comments state
  private readonly _comments = signal<CommentDisplay[]>([]);
  private readonly _commentsLoading = signal(false);
  private readonly _commentsError = signal<string | null>(null);
  private readonly _commentsCursor = signal<string | null>(null);
  private readonly _commentsHasMore = signal(true);
  private readonly _currentPostId = signal<string | null>(null);
  private commentsUnsubscribe: (() => void) | null = null;
  private postUnsubscribe: (() => void) | null = null;
  private postsMetricsUnsubscribes: (() => void)[] = []; // Subscriptions to post documents for real-time metrics

  // Post creation state
  private readonly _creating = signal(false);
  private readonly _createError = signal<string | null>(null);

  // Post deletion state
  private readonly _deletingPostId = signal<string | null>(null);
  private deletedPostIds = new Set<string>(); // Track deleted posts to filter from subscriptions

  // User feed stats
  private readonly _userPostsCount = signal<number>(0);
  private readonly _likesReceivedCount = signal<number>(0);
  private readonly _commentsReceivedCount = signal<number>(0);
  private readonly _feedStatsLoading = signal<boolean>(false);

  // Public signals
  readonly posts = this._posts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly activeTab = this._activeTab.asReadonly();
  readonly activeSubFilter = this._activeSubFilter.asReadonly();

  readonly comments = this._comments.asReadonly();
  readonly commentsLoading = this._commentsLoading.asReadonly();
  readonly commentsError = this._commentsError.asReadonly();
  readonly commentsHasMore = this._commentsHasMore.asReadonly();

  readonly creating = this._creating.asReadonly();
  readonly createError = this._createError.asReadonly();
  readonly deletingPostId = this._deletingPostId.asReadonly();

  // Feed stats (posts created, likes received, comments received)
  readonly userPostsCount = this._userPostsCount.asReadonly();
  readonly likesReceivedCount = this._likesReceivedCount.asReadonly();
  readonly commentsReceivedCount = this._commentsReceivedCount.asReadonly();
  readonly feedStatsLoading = this._feedStatsLoading.asReadonly();

  // Tab options for main navigation
  readonly tabOptions: { value: FeedTab; labelKey: string; icon: string }[] = [
    { value: 'feed', labelKey: 'FEED.TAB_FEED', icon: 'dynamic_feed' },
    { value: 'private', labelKey: 'FEED.TAB_PRIVATE', icon: 'lock' },
  ];

  // Sub-filter options for the Feed tab
  readonly subFilterOptions: { value: FeedSubFilter; labelKey: string; icon: string }[] = [
    { value: 'all', labelKey: 'FEED.FILTER_ALL', icon: 'public' },
    { value: 'matches', labelKey: 'FEED.FILTER_MATCHES', icon: 'people' },
  ];

  // Legacy filter options for backward compatibility
  readonly filterOptions: { value: FeedFilter; labelKey: string; icon: string }[] = [
    { value: 'all', labelKey: 'FEED.FILTER_ALL', icon: 'public' },
    { value: 'matches', labelKey: 'FEED.FILTER_MATCHES', icon: 'people' },
    { value: 'private', labelKey: 'FEED.FILTER_PRIVATE', icon: 'lock' },
  ];

  // Computed
  readonly isEmpty = computed(() => !this._loading() && this._posts().length === 0);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });

    // React to changes in blocked users - filter posts in real-time
    effect(() => {
      // Only track blockedUserIds as a dependency
      const blockedUsers = this.blockService.blockedUserIds();
      
      // Use untracked to read posts without creating a dependency (avoids infinite loop)
      untracked(() => {
        const currentUser = this.authService.user();
        if (!currentUser) return;
        
        // Only filter if we have posts
        const allPosts = this._allPosts();
        if (allPosts.length > 0) {
          // Filter out posts from blocked users
          const filteredPosts = allPosts.filter(
            (post) => !blockedUsers.has(post.author.uid) || post.author.uid === currentUser.uid
          );
          // Only update if something was filtered
          if (filteredPosts.length !== allPosts.length) {
            this._allPosts.set(filteredPosts);
            this.applyFilter();
          }
        }
        
        // Also filter user posts on profile pages
        const userPosts = this._userPosts();
        if (userPosts.length > 0) {
          const filteredUserPosts = userPosts.filter(
            (post) => !blockedUsers.has(post.author.uid) || post.author.uid === currentUser.uid
          );
          if (filteredUserPosts.length !== userPosts.length) {
            this._userPosts.set(filteredUserPosts);
          }
        }
      });
    });
  }

  /**
   * Subscribe to unified feed (public + matches + private)
   * All posts flow through feedItems via server-side fan-out with discover-style filtering
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

    // Subscribe to user's feedItems - all posts (public, matches, private)
    // are distributed via server-side fan-out with discover-style filtering
    const feedItemsRef = collection(this.firestore, 'users', user.uid, 'feedItems');
    const feedItemsQuery = query(
      feedItemsRef,
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );

    this.feedUnsubscribe = onSnapshot(
      feedItemsQuery,
      async (snapshot) => {
        const feedItems = snapshot.docs.map((d) => ({
          ...(d.data() as FeedItem),
          _docSnap: d,
        }));

        let posts: PostDisplay[] = [];
        if (feedItems.length > 0) {
          posts = await this.fetchPostsFromFeedItems(feedItems, user.uid);
          this.lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1] || null;
        }

        // Get current posts for preserving optimistic updates
        const currentPostsMap = new Map<string, PostDisplay>();
        this._allPosts().forEach((post) => currentPostsMap.set(post.id, post));

        // Build set of IDs from server
        const serverPostIds = new Set(posts.map((p) => p.id));

        // Preserve optimistic like state from cache
        posts = posts.map((post) => {
          const current = currentPostsMap.get(post.id);
          if (current) {
            const cachedLiked = this.likeStatusCache.get(post.id);
            if (cachedLiked !== undefined) {
              return { ...post, isLiked: cachedLiked, likeCount: current.likeCount };
            }
          }
          return post;
        });

        // Find optimistic posts not yet in server data (recently created posts)
        const optimisticPosts = this._allPosts().filter(
          (post) => !serverPostIds.has(post.id) && post.author.uid === user.uid
        );

        // Merge: optimistic posts first (they're newest), then server posts
        const mergedPosts = [...optimisticPosts, ...posts];

        // Filter out deleted posts
        const filteredPosts = mergedPosts.filter((post) => !this.deletedPostIds.has(post.id));

        this._allPosts.set(filteredPosts);
        this.applyFilter();
        this._loading.set(false);
        this._hasMore.set(snapshot.docs.length === PAGE_SIZE);

        // Subscribe to post documents for real-time metric updates
        const postIdsToSubscribe = filteredPosts.map((p) => p.id);
        this.subscribeToPostsMetrics(postIdsToSubscribe);
      },
      (error) => {
        console.error('Feed subscription error:', error);
        this._error.set('Failed to load feed. Please try again.');
        this._loading.set(false);
      }
    );
  }

  /**
   * Apply the current filter to the all posts collection
   */
  private applyFilter(): void {
    const allPosts = this._allPosts();
    const filter = this._activeFilter();

    if (filter === 'all') {
      // Show all posts EXCEPT private posts (private posts only visible on Private tab)
      const filtered = allPosts.filter((post) => post.source !== 'private');
      this._posts.set(filtered);
    } else if (filter === 'matches') {
      // Filter to only posts from matches (source === 'connection')
      const filtered = allPosts.filter((post) => post.source === 'connection');
      this._posts.set(filtered);
    } else if (filter === 'private') {
      // Filter to only private posts (source === 'private')
      const filtered = allPosts.filter((post) => post.source === 'private');
      this._posts.set(filtered);
    }
  }

  /**
   * Load saved filter from localStorage
   */
  private loadSavedFilter(): FeedFilter {
    if (!isPlatformBrowser(this.platformId)) return 'all';
    
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      if (saved === 'all' || saved === 'matches' || saved === 'private') {
        return saved;
      }
    } catch {
      // localStorage not available
    }
    return 'all';
  }

  /**
   * Save filter to localStorage
   */
  private saveFilter(filter: FeedFilter): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Load saved tab from localStorage
   */
  private loadSavedTab(): FeedTab {
    if (!isPlatformBrowser(this.platformId)) return 'feed';
    
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      if (saved === 'feed' || saved === 'private') {
        return saved;
      }
    } catch {
      // localStorage not available
    }
    return 'feed';
  }

  /**
   * Save tab to localStorage
   */
  private saveTab(tab: FeedTab): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Load saved sub-filter from localStorage
   */
  private loadSavedSubFilter(): FeedSubFilter {
    if (!isPlatformBrowser(this.platformId)) return 'all';
    
    try {
      const saved = localStorage.getItem(SUBFILTER_STORAGE_KEY);
      if (saved === 'all' || saved === 'matches') {
        return saved;
      }
    } catch {
      // localStorage not available
    }
    return 'all';
  }

  /**
   * Save sub-filter to localStorage
   */
  private saveSubFilter(subFilter: FeedSubFilter): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    try {
      localStorage.setItem(SUBFILTER_STORAGE_KEY, subFilter);
    } catch {
      // localStorage not available
    }
  }

  /**
   * Set the active filter and apply it
   */
  setFilter(filter: FeedFilter): void {
    if (this._activeFilter() === filter) return;
    this._activeFilter.set(filter);
    this.saveFilter(filter);
    this.applyFilter();
  }

  /**
   * Set the active tab and apply corresponding filter
   */
  setTab(tab: FeedTab): void {
    if (this._activeTab() === tab) return;
    this._activeTab.set(tab);
    this.saveTab(tab);
    
    // Apply the corresponding filter based on tab
    if (tab === 'private') {
      this.setFilter('private');
    } else {
      // Apply the current sub-filter for the feed tab
      this.setFilter(this._activeSubFilter());
    }
  }

  /**
   * Set the active sub-filter (for Feed tab)
   */
  setSubFilter(subFilter: FeedSubFilter): void {
    if (this._activeSubFilter() === subFilter) return;
    this._activeSubFilter.set(subFilter);
    this.saveSubFilter(subFilter);
    
    // Only apply if we're on the feed tab
    if (this._activeTab() === 'feed') {
      this.setFilter(subFilter);
    }
  }

  /**
   * Subscribe to post documents for real-time metric updates (likes, comments)
   * Uses batched queries since Firestore 'in' supports up to 30 items
   */
  private subscribeToPostsMetrics(postIds: string[]): void {
    // Cleanup existing subscriptions
    this.postsMetricsUnsubscribes.forEach((unsub) => unsub());
    this.postsMetricsUnsubscribes = [];

    if (postIds.length === 0) return;

    // Batch into groups of 30 (Firestore 'in' query limit)
    const BATCH_SIZE = 30;
    for (let i = 0; i < postIds.length; i += BATCH_SIZE) {
      const batchIds = postIds.slice(i, i + BATCH_SIZE);
      const postsQuery = query(
        collection(this.firestore, 'posts'),
        where(documentId(), 'in', batchIds)
      );

      const unsub = onSnapshot(
        postsQuery,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
              const postData = change.doc.data() as Post;
              const postId = change.doc.id;

              // Update metrics in _allPosts
              this._allPosts.update((posts) =>
                posts.map((post) =>
                  post.id === postId
                    ? {
                        ...post,
                        likeCount: postData.metrics?.likeCount ?? post.likeCount,
                        commentCount: postData.metrics?.commentCount ?? post.commentCount,
                      }
                    : post
                )
              );

              // Also update _posts (filtered view)
              this._posts.update((posts) =>
                posts.map((post) =>
                  post.id === postId
                    ? {
                        ...post,
                        likeCount: postData.metrics?.likeCount ?? post.likeCount,
                        commentCount: postData.metrics?.commentCount ?? post.commentCount,
                      }
                    : post
                )
              );
            }
          });
        },
        (error) => {
          // Log but don't crash - real-time metrics are a nice-to-have
          console.warn('Post metrics subscription error (non-fatal):', error);
        }
      );

      this.postsMetricsUnsubscribes.push(unsub);
    }
  }

  /**
   * @deprecated Use subscribeToFeed() instead
   */
  subscribeToExploreFeed(): void {
    this.subscribeToFeed();
  }

  /**
   * @deprecated Use subscribeToFeed() instead
   */
  subscribeToHomeFeed(): void {
    this.subscribeToFeed();
  }

  /**
   * Load more posts (pagination)
   */
  async loadMore(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const user = this.authService.user();
    if (!user || !this._hasMore() || this._loadingMore()) return;

    if (!this.lastVisibleDoc) return;

    this._loadingMore.set(true);

    try {
      await this.loadMoreFeedItems(user.uid);
    } catch (error) {
      console.error('Failed to load more posts:', error);
    } finally {
      this._loadingMore.set(false);
    }
  }

  private async loadMoreFeedItems(userId: string): Promise<void> {
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

    // Wait for all fetches to complete
    await Promise.all(fetchPromises);

    // Get blocked users from BlockService (real-time source of truth)
    const blockedUsers = this.blockService.blockedUserIds();

    // Build posts array using cached data
    const posts: PostDisplay[] = [];

    for (const docSnap of docs) {
      const postData = docSnap.data() as Post;

      // Skip blocked authors (except own posts)
      if (
        blockedUsers.has(postData.authorId) &&
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

    await Promise.all(fetchPromises);

    // Get blocked users from BlockService (real-time source of truth)
    const blockedUsers = this.blockService.blockedUserIds();

    // Build posts array using cached data
    const posts: PostDisplay[] = [];

    for (const { postId, postData, feedItem } of validPosts) {
      // Skip blocked authors (except own posts)
      if (
        blockedUsers.has(postData.authorId) &&
        postData.authorId !== currentUserId
      ) {
        continue;
      }

      const authorData = this.authorDataCache.get(postData.authorId) || {};
      const createdAt = postData.createdAt as Timestamp;

      // Determine source based on the FeedItem's reason
      let source: PostSource;
      if (feedItem.reason === 'own') {
        // Author's own post - use visibility to determine source
        source = feedItem.visibility as PostSource;
      } else if (feedItem.reason === 'public') {
        source = 'public';
      } else if (feedItem.reason === 'approved' || feedItem.visibility === 'private') {
        source = 'private';
      } else {
        source = 'connection';
      }

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
    if (this.feedUnsubscribe) {
      this.feedUnsubscribe();
      this.feedUnsubscribe = null;
    }
    // Cleanup posts metrics subscriptions
    this.postsMetricsUnsubscribes.forEach((unsub) => unsub());
    this.postsMetricsUnsubscribes = [];
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
    const user = this.authService.user();
    if (!user) {
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

      // Optimistic update: immediately add the post to the feed
      if (result.data.success && result.data.postId) {
        const visibility = request.visibility || 'public';
        const optimisticPost: PostDisplay = {
          id: result.data.postId,
          author: {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            reputationTier: undefined,
            isVerified: false,
          },
          content: request.content,
          visibility,
          createdAt: new Date(),
          likeCount: 0,
          commentCount: 0,
          isLiked: false,
          isOwn: true,
          status: 'active',
          source: visibility as PostSource,
        };

        // Prepend to the feed (newest first)
        this._allPosts.update((posts) => [optimisticPost, ...posts]);
        this.applyFilter();
      }

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

    // Optimistic update - cache, _allPosts (source), and _posts (filtered view)
    this.likeStatusCache.set(postId, true);
    
    const updateLike = (posts: PostDisplay[]) =>
      posts.map((post) =>
        post.id === postId
          ? { ...post, isLiked: true, likeCount: post.likeCount + 1 }
          : post
      );
    
    this._allPosts.update(updateLike);
    this._posts.update(updateLike);

    try {
      const likePostFn = httpsCallable<{ postId: string }, { success: boolean }>(
        this.functions,
        'likePost'
      );

      await likePostFn({ postId });
      return true;
    } catch (err) {
      console.error('Failed to like post:', err);

      // Revert optimistic update - cache, _allPosts, and _posts
      this.likeStatusCache.set(postId, false);
      
      const revertLike = (posts: PostDisplay[]) =>
        posts.map((post) =>
          post.id === postId
            ? { ...post, isLiked: false, likeCount: post.likeCount - 1 }
            : post
        );
      
      this._allPosts.update(revertLike);
      this._posts.update(revertLike);
      return false;
    }
  }

  /**
   * Unlike a post
   */
  async unlikePost(postId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    // Optimistic update - cache, _allPosts (source), and _posts (filtered view)
    this.likeStatusCache.set(postId, false);
    
    const updateUnlike = (posts: PostDisplay[]) =>
      posts.map((post) =>
        post.id === postId
          ? { ...post, isLiked: false, likeCount: Math.max(0, post.likeCount - 1) }
          : post
      );
    
    this._allPosts.update(updateUnlike);
    this._posts.update(updateUnlike);

    try {
      const unlikePostFn = httpsCallable<{ postId: string }, { success: boolean }>(
        this.functions,
        'unlikePost'
      );

      await unlikePostFn({ postId });
      return true;
    } catch (err) {
      console.error('Failed to unlike post:', err);

      // Revert optimistic update - cache, _allPosts, and _posts
      this.likeStatusCache.set(postId, true);
      
      const revertUnlike = (posts: PostDisplay[]) =>
        posts.map((post) =>
          post.id === postId
            ? { ...post, isLiked: true, likeCount: post.likeCount + 1 }
            : post
        );
      
      this._allPosts.update(revertUnlike);
      this._posts.update(revertUnlike);
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
   * Report a comment
   * TODO: Add backend function for this
   */
  async reportComment(postId: string, commentId: string, reason?: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    try {
      // TODO: Add reportComment cloud function
      console.log(`Reported comment ${commentId} on post ${postId} with reason: ${reason}`);
      return true;
    } catch (err) {
      console.error('Failed to report comment:', err);
      return false;
    }
  }

  /**
   * Remove all posts by a specific user from the local feed
   * Used when blocking a user
   */
  removePostsByUser(userId: string): void {
    this._allPosts.update((posts) => posts.filter((post) => post.author.uid !== userId));
    this._posts.update((posts) => posts.filter((post) => post.author.uid !== userId));
  }

  /**
   * Fetch a single post by ID
   * Returns null if post not found or user doesn't have access
   */
  async getPostById(postId: string): Promise<PostDisplay | null> {
    const user = this.authService.user();
    if (!user) return null;

    try {
      const postDoc = await getDoc(doc(this.firestore, 'posts', postId));
      if (!postDoc.exists()) return null;

      const postData = postDoc.data() as Post;
      if (postData.status !== 'active') return null;

      // Fetch author data
      const authorDoc = await getDoc(doc(this.firestore, 'users', postData.authorId));
      const authorData = authorDoc.data() || {};

      // Check if current user liked this post
      const likeDoc = await getDoc(doc(this.firestore, 'posts', postId, 'likes', user.uid));
      const isLiked = likeDoc.exists();

      const createdAt = postData.createdAt as Timestamp;

      return {
        id: postId,
        author: {
          uid: postData.authorId,
          displayName: (authorData['displayName'] as string) || null,
          photoURL: (authorData['photoURL'] as string) || null,
          isVerified: (authorData['isVerified'] as boolean) || false,
          reputationTier: (authorData['reputationTier'] as ReputationTier) || undefined,
        },
        content: {
          type: postData.content?.type || 'text',
          text: postData.content?.text || undefined,
          media: postData.content?.media || [],
        },
        createdAt: createdAt?.toDate() || new Date(),
        likeCount: postData.metrics?.likeCount || 0,
        commentCount: postData.metrics?.commentCount || 0,
        isLiked,
        isOwn: postData.authorId === user.uid,
        source: 'public',
        visibility: postData.visibility || 'public',
        status: postData.status || 'active',
      };
    } catch (error) {
      console.error('Error fetching post:', error);
      return null;
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
        try {
          const comments: CommentDisplay[] = [];

          // First, check likes for any comments not in cache
          const commentIdsToCheck = snapshot.docs
            .map(d => d.id)
            .filter(id => !this.commentLikeStatusCache.has(id));
          
          if (commentIdsToCheck.length > 0) {
            try {
              const likeChecks = await Promise.all(
                commentIdsToCheck.map(commentId =>
                  getDoc(doc(this.firestore, 'posts', postId, 'comments', commentId, 'likes', user.uid))
                )
              );
              commentIdsToCheck.forEach((commentId, i) => {
                this.commentLikeStatusCache.set(commentId, likeChecks[i].exists());
              });
            } catch (likeErr) {
              console.warn('Failed to check comment likes:', likeErr);
              // Continue without like status - default to false
            }
          }

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const authorId = data['authorId'] as string;
            
            // Get author info from cache or fetch
            let authorData = this.authorDataCache.get(authorId);
            if (!authorData) {
              try {
                const authorDoc = await getDoc(doc(this.firestore, 'users', authorId));
                authorData = authorDoc.data() || {};
                this.authorDataCache.set(authorId, authorData);
              } catch {
                authorData = {};
              }
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
              likeCount: (data['likeCount'] as number) || 0,
              isLiked: this.commentLikeStatusCache.get(docSnap.id) ?? false,
              parentCommentId: (data['parentCommentId'] as string) || undefined,
            });
          }

          this._comments.set(comments);
          this._commentsLoading.set(false);
        } catch (err) {
          console.error('Error processing comments:', err);
          this._commentsError.set('Failed to load comments');
          this._commentsLoading.set(false);
        }
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
   * @param parentCommentId - If replying to a comment, the parent comment ID
   */
  async addComment(postId: string, content: string, parentCommentId?: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    try {
      const addCommentFn = httpsCallable<
        { postId: string; content: string; parentCommentId?: string },
        { success: boolean; commentId?: string }
      >(this.functions, 'addComment');

      const result = await addCommentFn({ postId, content, parentCommentId });
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
   * Like a comment
   */
  async likeComment(postId: string, commentId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    // Update cache
    this.commentLikeStatusCache.set(commentId, true);

    // Optimistic update
    this._comments.update((comments) =>
      comments.map((comment) =>
        comment.id === commentId
          ? { ...comment, isLiked: true, likeCount: comment.likeCount + 1 }
          : comment
      )
    );

    try {
      const likeCommentFn = httpsCallable<
        { postId: string; commentId: string },
        { success: boolean }
      >(this.functions, 'likeComment');

      await likeCommentFn({ postId, commentId });
      return true;
    } catch (err) {
      console.error('Failed to like comment:', err);
      // Revert cache
      this.commentLikeStatusCache.set(commentId, false);
      // Revert optimistic update
      this._comments.update((comments) =>
        comments.map((comment) =>
          comment.id === commentId
            ? { ...comment, isLiked: false, likeCount: Math.max(0, comment.likeCount - 1) }
            : comment
        )
      );
      return false;
    }
  }

  /**
   * Unlike a comment
   */
  async unlikeComment(postId: string, commentId: string): Promise<boolean> {
    if (!this.authService.user()) return false;

    // Update cache
    this.commentLikeStatusCache.set(commentId, false);

    // Optimistic update
    this._comments.update((comments) =>
      comments.map((comment) =>
        comment.id === commentId
          ? { ...comment, isLiked: false, likeCount: Math.max(0, comment.likeCount - 1) }
          : comment
      )
    );

    try {
      const unlikeCommentFn = httpsCallable<
        { postId: string; commentId: string },
        { success: boolean }
      >(this.functions, 'unlikeComment');

      await unlikeCommentFn({ postId, commentId });
      return true;
    } catch (err) {
      console.error('Failed to unlike comment:', err);
      // Revert cache
      this.commentLikeStatusCache.set(commentId, true);
      // Revert optimistic update
      this._comments.update((comments) =>
        comments.map((comment) =>
          comment.id === commentId
            ? { ...comment, isLiked: true, likeCount: comment.likeCount + 1 }
            : comment
        )
      );
      return false;
    }
  }

  /**
   * Toggle like on a comment
   */
  async toggleCommentLike(postId: string, comment: CommentDisplay): Promise<boolean> {
    if (comment.isLiked) {
      return this.unlikeComment(postId, comment.id);
    } else {
      return this.likeComment(postId, comment.id);
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
    this.unsubscribeFromFeedStats();
    this._posts.set([]);
    this._allPosts.set([]);
    this._comments.set([]);
    this._cursor.set(null);
    this._commentsCursor.set(null);
    this._activeFilter.set('all');
    this.lastVisibleDoc = null;
    // Clear all caches
    this.likeStatusCache.clear();
    this.authorDataCache.clear();
  }

  // Legacy cursor (kept for compatibility)
  private readonly _cursor = signal<string | null>(null);

  // ============================================================================
  // USER PROFILE POSTS
  // Fetch posts directly for a specific user (not from fan-out)
  // ============================================================================

  private userPostsUnsubscribe?: () => void;
  private readonly _userPosts = signal<PostDisplay[]>([]);
  private readonly _userPostsLoading = signal(false);
  private readonly _userPostsLoadingMore = signal(false);
  private readonly _userPostsHasMore = signal(true);
  private readonly _userPostsError = signal<string | null>(null);
  private lastUserPostDoc: QueryDocumentSnapshot | null = null;
  private currentProfileUserId: string | null = null;

  readonly userPosts = this._userPosts.asReadonly();
  readonly userPostsLoading = this._userPostsLoading.asReadonly();
  readonly userPostsLoadingMore = this._userPostsLoadingMore.asReadonly();
  readonly userPostsHasMore = this._userPostsHasMore.asReadonly();
  readonly userPostsError = this._userPostsError.asReadonly();

  /**
   * Subscribe to posts from a specific user
   * @param userId - The user whose posts to fetch
   * @param hasPrivateAccess - Whether the current user has private content access
   */
  subscribeToUserPosts(userId: string, hasPrivateAccess: boolean): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const currentUser = this.authService.user();
    if (!currentUser) return;

    // Cleanup existing subscription
    this.unsubscribeFromUserPosts();
    
    this.currentProfileUserId = userId;
    this._userPostsLoading.set(true);
    this._userPostsError.set(null);
    this._userPostsHasMore.set(true);
    this._userPosts.set([]);
    this.lastUserPostDoc = null;

    // Build query for user's posts
    const postsRef = collection(this.firestore, 'posts');
    
    // Determine which visibilities we can see
    const isOwnProfile = userId === currentUser.uid;
    let visibilities: PostVisibility[];
    
    if (isOwnProfile) {
      // User can see all their own posts
      visibilities = ['public', 'matches', 'private'];
    } else if (hasPrivateAccess) {
      // Has private access - can see public and private
      visibilities = ['public', 'private'];
    } else {
      // Only public posts
      visibilities = ['public'];
    }

    const postsQuery = query(
      postsRef,
      where('authorId', '==', userId),
      where('status', '==', 'active'),
      where('visibility', 'in', visibilities),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );

    this.userPostsUnsubscribe = onSnapshot(
      postsQuery,
      async (snapshot) => {
        try {
          const posts: PostDisplay[] = [];

          // Update last doc for pagination
          if (snapshot.docs.length > 0) {
            this.lastUserPostDoc = snapshot.docs[snapshot.docs.length - 1];
          }

          // Check if we have more
          this._userPostsHasMore.set(snapshot.docs.length >= PAGE_SIZE);

          // Get author data once (it's the same for all posts)
          let authorData: { displayName: string | null; photoURL: string | null; reputationTier?: ReputationTier; isVerified?: boolean } | null = null;
          
          if (snapshot.docs.length > 0) {
            const cachedAuthor = this.authorDataCache.get(userId);
            if (cachedAuthor) {
              authorData = {
                displayName: (cachedAuthor['displayName'] as string) || null,
                photoURL: (cachedAuthor['photoURL'] as string) || null,
                reputationTier: cachedAuthor['reputationTier'] as ReputationTier,
                isVerified: cachedAuthor['identityVerified'] === true,
              };
            } else {
              const authorDoc = await getDoc(doc(this.firestore, 'users', userId));
              if (authorDoc.exists()) {
                const data = authorDoc.data();
                this.authorDataCache.set(userId, data);
                authorData = {
                  displayName: (data['displayName'] as string) || null,
                  photoURL: (data['photoURL'] as string) || null,
                  reputationTier: data['reputationTier'] as ReputationTier,
                  isVerified: data['identityVerified'] === true,
                };
              }
            }
          }

          // Check like status for all posts
          const postIds = snapshot.docs.map(d => d.id);
          const likeChecks = await Promise.all(
            postIds.map(async (postId) => {
              if (this.likeStatusCache.has(postId)) {
                return { postId, isLiked: this.likeStatusCache.get(postId)! };
              }
              const likeDoc = await getDoc(
                doc(this.firestore, 'posts', postId, 'likes', currentUser.uid)
              );
              const isLiked = likeDoc.exists();
              this.likeStatusCache.set(postId, isLiked);
              return { postId, isLiked };
            })
          );
          const likeMap = new Map(likeChecks.map(l => [l.postId, l.isLiked]));

          // Build post display objects
          for (const docSnap of snapshot.docs) {
            const data = docSnap.data() as Post;
            const createdAt = (data.createdAt as Timestamp)?.toDate?.() || new Date();

            posts.push({
              id: docSnap.id,
              author: {
                uid: userId,
                displayName: authorData?.displayName || null,
                photoURL: authorData?.photoURL || null,
                reputationTier: authorData?.reputationTier,
                isVerified: authorData?.isVerified,
              },
              content: data.content,
              visibility: data.visibility,
              likeCount: data.metrics?.likeCount || 0,
              commentCount: data.metrics?.commentCount || 0,
              isLiked: likeMap.get(docSnap.id) || false,
              isOwn: userId === currentUser.uid,
              createdAt,
              status: data.status,
            });
          }

          this._userPosts.set(posts);
        } catch (error) {
          console.error('Error processing user posts:', error);
          this._userPostsError.set('Failed to load posts');
        } finally {
          this._userPostsLoading.set(false);
        }
      },
      (error) => {
        console.error('Error subscribing to user posts:', error);
        this._userPostsError.set('Failed to load posts');
        this._userPostsLoading.set(false);
      }
    );
  }

  /**
   * Load more posts for a user profile
   */
  async loadMoreUserPosts(userId: string, hasPrivateAccess: boolean): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const currentUser = this.authService.user();
    if (!currentUser || !this._userPostsHasMore() || this._userPostsLoadingMore()) return;
    if (!this.lastUserPostDoc) return;

    this._userPostsLoadingMore.set(true);

    try {
      const postsRef = collection(this.firestore, 'posts');
      
      // Same visibility logic
      const isOwnProfile = userId === currentUser.uid;
      let visibilities: PostVisibility[];
      
      if (isOwnProfile) {
        visibilities = ['public', 'matches', 'private'];
      } else if (hasPrivateAccess) {
        visibilities = ['public', 'private'];
      } else {
        visibilities = ['public'];
      }

      const postsQuery = query(
        postsRef,
        where('authorId', '==', userId),
        where('status', '==', 'active'),
        where('visibility', 'in', visibilities),
        orderBy('createdAt', 'desc'),
        startAfter(this.lastUserPostDoc),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(postsQuery);
      
      if (snapshot.docs.length > 0) {
        this.lastUserPostDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      this._userPostsHasMore.set(snapshot.docs.length >= PAGE_SIZE);

      // Get author data
      let authorData: { displayName: string | null; photoURL: string | null; reputationTier?: ReputationTier; isVerified?: boolean } | null = null;
      const cachedAuthor = this.authorDataCache.get(userId);
      if (cachedAuthor) {
        authorData = {
          displayName: (cachedAuthor['displayName'] as string) || null,
          photoURL: (cachedAuthor['photoURL'] as string) || null,
          reputationTier: cachedAuthor['reputationTier'] as ReputationTier,
          isVerified: cachedAuthor['identityVerified'] === true,
        };
      } else {
        const authorDoc = await getDoc(doc(this.firestore, 'users', userId));
        if (authorDoc.exists()) {
          const data = authorDoc.data();
          this.authorDataCache.set(userId, data);
          authorData = {
            displayName: (data['displayName'] as string) || null,
            photoURL: (data['photoURL'] as string) || null,
            reputationTier: data['reputationTier'] as ReputationTier,
            isVerified: data['identityVerified'] === true,
          };
        }
      }

      // Check like status
      const postIds = snapshot.docs.map(d => d.id);
      const likeChecks = await Promise.all(
        postIds.map(async (postId) => {
          if (this.likeStatusCache.has(postId)) {
            return { postId, isLiked: this.likeStatusCache.get(postId)! };
          }
          const likeDoc = await getDoc(
            doc(this.firestore, 'posts', postId, 'likes', currentUser.uid)
          );
          const isLiked = likeDoc.exists();
          this.likeStatusCache.set(postId, isLiked);
          return { postId, isLiked };
        })
      );
      const likeMap = new Map(likeChecks.map(l => [l.postId, l.isLiked]));

      // Build new posts
      const newPosts: PostDisplay[] = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as Post;
        const createdAt = (data.createdAt as Timestamp)?.toDate?.() || new Date();

        newPosts.push({
          id: docSnap.id,
          author: {
            uid: userId,
            displayName: authorData?.displayName || null,
            photoURL: authorData?.photoURL || null,
            reputationTier: authorData?.reputationTier,
            isVerified: authorData?.isVerified,
          },
          content: data.content,
          visibility: data.visibility,
          likeCount: data.metrics?.likeCount || 0,
          commentCount: data.metrics?.commentCount || 0,
          isLiked: likeMap.get(docSnap.id) || false,
          isOwn: userId === currentUser.uid,
          createdAt,
          status: data.status,
        });
      }

      // Append to existing posts
      this._userPosts.update(posts => [...posts, ...newPosts]);
    } catch (error) {
      console.error('Failed to load more user posts:', error);
    } finally {
      this._userPostsLoadingMore.set(false);
    }
  }

  /**
   * Unsubscribe from user posts
   */
  unsubscribeFromUserPosts(): void {
    this.userPostsUnsubscribe?.();
    this.userPostsUnsubscribe = undefined;
    this.currentProfileUserId = null;
    this.lastUserPostDoc = null;
  }

  /**
   * Clear user posts state
   */
  clearUserPosts(): void {
    this.unsubscribeFromUserPosts();
    this._userPosts.set([]);
    this._userPostsLoading.set(false);
    this._userPostsError.set(null);
    this._userPostsHasMore.set(true);
  }

  // ============================================================================
  // USER FEED STATS
  // ============================================================================

  /**
   * Subscribe to feed stats for the current user (posts count, likes received, comments received)
   * Uses real-time subscription to update stats as likes/comments change
   */
  subscribeToFeedStats(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const currentUser = this.authService.user();
    if (!currentUser) return;

    // Cleanup existing subscription
    this.unsubscribeFromFeedStats();

    this._feedStatsLoading.set(true);

    const postsRef = collection(this.firestore, 'posts');
    
    // Subscribe to user's active posts to get real-time metrics
    const userPostsQuery = query(
      postsRef,
      where('authorId', '==', currentUser.uid),
      where('status', '==', 'active'),
      limit(100) // Limit to avoid performance issues
    );
    
    this.feedStatsUnsubscribe = onSnapshot(
      userPostsQuery,
      (snapshot) => {
        let totalLikes = 0;
        let totalComments = 0;
        
        for (const postDoc of snapshot.docs) {
          const postData = postDoc.data();
          const metrics = postData['metrics'] as { likeCount?: number; commentCount?: number } | undefined;
          totalLikes += metrics?.likeCount || 0;
          totalComments += metrics?.commentCount || 0;
        }
        
        this._userPostsCount.set(snapshot.docs.length);
        this._likesReceivedCount.set(totalLikes);
        this._commentsReceivedCount.set(totalComments);
        this._feedStatsLoading.set(false);
      },
      (error) => {
        console.error('Failed to subscribe to feed stats:', error);
        this._feedStatsLoading.set(false);
      }
    );
  }

  /**
   * Unsubscribe from feed stats
   */
  private unsubscribeFromFeedStats(): void {
    if (this.feedStatsUnsubscribe) {
      this.feedStatsUnsubscribe();
      this.feedStatsUnsubscribe = null;
    }
  }

  /**
   * @deprecated Use subscribeToFeedStats() instead for real-time updates
   */
  async loadUserFeedStats(): Promise<void> {
    this.subscribeToFeedStats();
  }
}
