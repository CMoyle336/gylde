import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
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
} from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root',
})
export class FirestoreService {
  private readonly firestore = inject(Firestore);

  async getDocument<T>(collectionName: string, documentId: string): Promise<T | null> {
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
    const collectionRef = collection(this.firestore, collectionName);
    const q = query(collectionRef, ...constraints);
    const querySnapshot = await getDocs(q);

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
    const docRef = doc(this.firestore, collectionName, documentId);
    await setDoc(docRef, data, { merge });
  }

  async updateDocument(
    collectionName: string,
    documentId: string,
    data: Partial<DocumentData>
  ): Promise<void> {
    const docRef = doc(this.firestore, collectionName, documentId);
    await updateDoc(docRef, data);
  }

  async deleteDocument(collectionName: string, documentId: string): Promise<void> {
    const docRef = doc(this.firestore, collectionName, documentId);
    await deleteDoc(docRef);
  }

  subscribeToDocument<T>(
    collectionName: string,
    documentId: string,
    callback: (data: T | null) => void
  ): Unsubscribe {
    const docRef = doc(this.firestore, collectionName, documentId);
    return onSnapshot(docRef, (docSnap) => {
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
    const collectionRef = collection(this.firestore, collectionName);
    const q = query(collectionRef, ...constraints);
    return onSnapshot(q, (querySnapshot) => {
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as T[];
      callback(data);
    });
  }

  // Query helpers
  whereEqual(field: string, value: unknown) {
    return where(field, '==', value);
  }

  whereIn(field: string, values: unknown[]) {
    return where(field, 'in', values);
  }

  orderByField(field: string, direction: 'asc' | 'desc' = 'asc') {
    return orderBy(field, direction);
  }

  limitTo(count: number) {
    return limit(count);
  }
}
