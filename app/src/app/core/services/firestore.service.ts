import { Injectable, inject, isDevMode } from '@angular/core';
import {
  Firestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  DocumentData,
  QueryConstraint,
  onSnapshot,
  Unsubscribe,
  writeBatch,
  serverTimestamp,
  DocumentReference,
  WhereFilterOp,
  arrayUnion,
  arrayRemove,
  deleteField,
  FieldValue,
  documentId,
} from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root',
})
export class FirestoreService {
  private readonly firestore = inject(Firestore);
  
  // Enable/disable Firestore request logging (only in dev mode)
  private readonly enableLogging = isDevMode();
  
  private log(operation: string, path: string, details?: unknown): void {
    if (!this.enableLogging) return;
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const detailStr = details ? ` | ${JSON.stringify(details)}` : '';
    console.log(`%c[Firestore] ${timestamp} ${operation.padEnd(12)} ${path}${detailStr}`, 
      this.getLogStyle(operation));
  }
  
  private getLogStyle(operation: string): string {
    const styles: Record<string, string> = {
      'GET': 'color: #4CAF50; font-weight: bold;',
      'LIST': 'color: #2196F3; font-weight: bold;',
      'LIST_GROUP': 'color: #3F51B5; font-weight: bold;',
      'SET': 'color: #FF9800; font-weight: bold;',
      'ADD': 'color: #FFC107; font-weight: bold;',
      'UPDATE': 'color: #9C27B0; font-weight: bold;',
      'DELETE': 'color: #f44336; font-weight: bold;',
      'BATCH': 'color: #E91E63; font-weight: bold;',
      'SUBSCRIBE': 'color: #00BCD4; font-weight: bold;',
      'SNAPSHOT': 'color: #607D8B;',
    };
    return styles[operation] || 'color: #757575;';
  }

  async getDocument<T>(collectionName: string, documentId: string): Promise<T | null> {
    this.log('GET', `${collectionName}/${documentId}`);
    const docRef = doc(this.firestore, collectionName, documentId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
  }

  async getCollection<T>(
    collectionName: string,
    constraints: QueryConstraint[] = []
  ): Promise<T[]> {
    this.log('LIST', collectionName, { constraints: constraints.length });
    const collectionRef = collection(this.firestore, collectionName);
    const q = query(collectionRef, ...constraints);
    const querySnapshot = await getDocs(q);

    this.log('LIST', collectionName, { results: querySnapshot.size });
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as T[];
  }

  async setDocument(
    collectionName: string,
    documentId: string,
    data: DocumentData,
    merge = true
  ): Promise<void> {
    this.log('SET', `${collectionName}/${documentId}`, { merge });
    const docRef = doc(this.firestore, collectionName, documentId);
    await setDoc(docRef, data, { merge });
  }

  async updateDocument(
    collectionName: string,
    documentId: string,
    data: Partial<DocumentData>
  ): Promise<void> {
    this.log('UPDATE', `${collectionName}/${documentId}`, { fields: Object.keys(data) });
    const docRef = doc(this.firestore, collectionName, documentId);
    await updateDoc(docRef, data);
  }

  async deleteDocument(collectionName: string, documentId: string): Promise<void> {
    this.log('DELETE', `${collectionName}/${documentId}`);
    const docRef = doc(this.firestore, collectionName, documentId);
    await deleteDoc(docRef);
  }

  subscribeToDocument<T>(
    collectionName: string,
    documentId: string,
    callback: (data: T | null) => void
  ): Unsubscribe {
    const path = `${collectionName}/${documentId}`;
    this.log('SUBSCRIBE', path);
    const docRef = doc(this.firestore, collectionName, documentId);
    return onSnapshot(docRef, (docSnap) => {
      this.log('SNAPSHOT', path, { exists: docSnap.exists() });
      if (docSnap.exists()) {
        callback({ id: docSnap.id, ...docSnap.data() } as T);
      } else {
        callback(null);
      }
    });
  }

  subscribeToCollection<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    callback: (data: T[]) => void
  ): Unsubscribe {
    this.log('SUBSCRIBE', collectionName, { constraints: constraints.length });
    const collectionRef = collection(this.firestore, collectionName);
    const q = query(collectionRef, ...constraints);
    return onSnapshot(q, (querySnapshot) => {
      this.log('SNAPSHOT', collectionName, { docs: querySnapshot.size });
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as T[];
      callback(data);
    });
  }

  /**
   * Add a new document with auto-generated ID
   */
  async addDocument<T extends DocumentData>(
    collectionName: string,
    data: T
  ): Promise<string> {
    this.log('ADD', collectionName, { fields: Object.keys(data) });
    const collectionRef = collection(this.firestore, collectionName);
    const docRef = await addDoc(collectionRef, data);
    return docRef.id;
  }

  /**
   * Query a collection group (queries across all subcollections with the same name)
   */
  async queryCollectionGroup<T>(
    collectionId: string,
    constraints: QueryConstraint[] = []
  ): Promise<T[]> {
    this.log('LIST_GROUP', collectionId, { constraints: constraints.length });
    const groupRef = collectionGroup(this.firestore, collectionId);
    const q = query(groupRef, ...constraints);
    const querySnapshot = await getDocs(q);

    this.log('LIST_GROUP', collectionId, { results: querySnapshot.size });
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as T[];
  }

  /**
   * Batch update multiple documents
   */
  async batchUpdate(
    updates: Array<{ collection: string; docId: string; data: Partial<DocumentData> }>
  ): Promise<void> {
    if (updates.length === 0) return;
    
    this.log('BATCH', 'update', { count: updates.length });
    const batch = writeBatch(this.firestore);
    
    for (const { collection: collName, docId, data } of updates) {
      const docRef = doc(this.firestore, collName, docId);
      batch.update(docRef, data);
    }
    
    await batch.commit();
  }

  /**
   * Batch delete multiple documents
   */
  async batchDelete(
    documents: Array<{ collection: string; docId: string }>
  ): Promise<void> {
    if (documents.length === 0) return;
    
    this.log('BATCH', 'delete', { count: documents.length });
    const batch = writeBatch(this.firestore);
    
    for (const { collection: collName, docId } of documents) {
      const docRef = doc(this.firestore, collName, docId);
      batch.delete(docRef);
    }
    
    await batch.commit();
  }

  /**
   * Subscribe to a collection group with real-time updates
   */
  subscribeToCollectionGroup<T>(
    collectionId: string,
    constraints: QueryConstraint[],
    callback: (data: T[]) => void
  ): Unsubscribe {
    this.log('SUBSCRIBE', `collectionGroup:${collectionId}`, { constraints: constraints.length });
    const groupRef = collectionGroup(this.firestore, collectionId);
    const q = query(groupRef, ...constraints);
    return onSnapshot(q, (querySnapshot) => {
      this.log('SNAPSHOT', `collectionGroup:${collectionId}`, { docs: querySnapshot.size });
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as T[];
      callback(data);
    });
  }

  /**
   * Get server timestamp value for use in documents
   */
  getServerTimestamp() {
    return serverTimestamp();
  }

  /**
   * Get array union field value (adds elements to array without duplicates)
   */
  getArrayUnion(...elements: unknown[]): FieldValue {
    return arrayUnion(...elements);
  }

  /**
   * Get array remove field value (removes elements from array)
   */
  getArrayRemove(...elements: unknown[]): FieldValue {
    return arrayRemove(...elements);
  }

  /**
   * Get delete field sentinel (removes a field from a document)
   */
  getDeleteField(): FieldValue {
    return deleteField();
  }

  // Query helpers
  whereEqual(field: string, value: unknown) {
    return where(field, '==', value);
  }

  whereNotEqual(field: string, value: unknown) {
    return where(field, '!=', value);
  }

  whereIn(field: string | ReturnType<typeof documentId>, values: unknown[]) {
    return where(field, 'in', values);
  }

  whereArrayContains(field: string, value: unknown) {
    return where(field, 'array-contains', value);
  }

  whereGreaterThan(field: string, value: unknown) {
    return where(field, '>', value);
  }

  whereLessThan(field: string, value: unknown) {
    return where(field, '<', value);
  }

  whereOp(field: string, op: WhereFilterOp, value: unknown) {
    return where(field, op, value);
  }

  orderByField(field: string, direction: 'asc' | 'desc' = 'asc') {
    return orderBy(field, direction);
  }

  limitTo(count: number) {
    return limit(count);
  }

  /**
   * Get a documentId() field path for querying by document ID
   */
  documentId() {
    return documentId();
  }
}
