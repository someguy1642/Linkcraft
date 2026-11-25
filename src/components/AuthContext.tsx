import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../firebase';
import type { BillingStatusResponse, ShortLink, SponsorCampaign } from '../shared/types';
import { api } from '../utils/api';
import { useToast } from './ToastProvider';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  signingIn: boolean;
  billing: BillingStatusResponse;
  refreshBilling: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  syncLinkToFirestore: (link: ShortLink) => Promise<void>;
  syncSponsorToFirestore: (sponsor: SponsorCampaign) => Promise<void>;
}

const DEFAULT_BILLING: BillingStatusResponse = {
  stripeConfigured: false,
  plan: 'free',
  uid: null,
  activeLinksCount: 0,
  maxFreeLinks: 25,
  priceMonthlyUsd: 15,
  hasStripeCustomer: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [billing, setBilling] = useState<BillingStatusResponse>(DEFAULT_BILLING);

  const ensureFirestoreUserDoc = useCallback(async (u: User) => {
    if (!u.emailVerified) return;
    const profilePath = `users/${u.uid}`;
    const profileRef = doc(db, 'users', u.uid);
    const displayName = (u.displayName || u.email?.split('@')[0] || 'Linkcraft User').slice(0, 100);
    const photoURL = u.photoURL && u.photoURL.length <= 500 ? u.photoURL : undefined;

    try {
      const snap = await getDoc(profileRef);
      if (!snap.exists()) {
        await setDoc(profileRef, {
          uid: u.uid,
          displayName,
          ...(photoURL ? { photoURL } : {}),
          plan: 'free',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(profileRef, {
          displayName,
          ...(photoURL ? { photoURL } : {}),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, profilePath);
    }

    if (u.email) {
      const accountPath = `users/${u.uid}/private/account`;
      const accountRef = doc(db, 'users', u.uid, 'private', 'account');
      try {
        const accountSnap = await getDoc(accountRef);
        if (!accountSnap.exists()) {
          await setDoc(accountRef, {
            uid: u.uid,
            email: u.email.slice(0, 254),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(accountRef, {
            email: u.email.slice(0, 254),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, accountPath);
      }
    }
  }, []);

  const refreshBilling = useCallback(async () => {
    try {
      const status = await api.getBillingStatus();
      setBilling(status);
    } catch {
      // Keep previous status if offline
    }
  }, []);

  useEffect(() => {
    void testFirestoreConnection();

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (nextUser) {
        try {
          await ensureFirestoreUserDoc(nextUser);
        } catch {
          // Non-fatal in UI; error details are logged by handleFirestoreError
        }
      }

      await refreshBilling();

      // Verify Stripe checkout return if present in query string
      if (nextUser && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('checkout_session_id');
        if (sessionId) {
          try {
            const updated = await api.verifyCheckoutSession(sessionId);
            setBilling(updated);
            if (updated.plan === 'pro') {
              showToast('Pro subscription activated! Thank you.', 'success');
            }
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to verify checkout session.', 'error');
          } finally {
            params.delete('checkout_session_id');
            const qs = params.toString();
            window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [ensureFirestoreUserDoc, refreshBilling, showToast]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Signed in with Google', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in cancelled or blocked.';
      showToast(msg, 'error');
    } finally {
      setSigningIn(false);
    }
  }, [showToast]);

  const logout = useCallback(async () => {
    await signOut(auth);
    await refreshBilling();
    showToast('Signed out', 'info');
  }, [refreshBilling, showToast]);

  const syncLinkToFirestore = useCallback(
    async (link: ShortLink) => {
      const u = auth.currentUser;
      if (!u || !u.emailVerified) return;
      const path = `userLinks/${link.id}`;
      const ref = doc(db, 'userLinks', link.id);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: link.id,
            ownerId: u.uid,
            code: link.code,
            targetUrl: link.targetUrl,
            interstitialEnabled: Boolean(link.interstitialEnabled),
            ...(link.sponsorId ? { sponsorId: link.sponsorId } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            targetUrl: link.targetUrl,
            interstitialEnabled: Boolean(link.interstitialEnabled),
            ...(link.sponsorId ? { sponsorId: link.sponsorId } : {}),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('Firestore link sync skipped:', path, err);
      }
    },
    [],
  );

  const syncSponsorToFirestore = useCallback(
    async (sponsor: SponsorCampaign) => {
      const u = auth.currentUser;
      if (!u || !u.emailVerified || sponsor.isDemo) return;
      const path = `sponsors/${sponsor.id}`;
      const ref = doc(db, 'sponsors', sponsor.id);
      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: sponsor.id,
            ownerId: u.uid,
            title: sponsor.title,
            description: sponsor.description,
            ctaLabel: sponsor.ctaLabel,
            ctaUrl: sponsor.ctaUrl,
            badgeText: sponsor.badgeText,
            active: sponsor.active,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            title: sponsor.title,
            description: sponsor.description,
            ctaLabel: sponsor.ctaLabel,
            ctaUrl: sponsor.ctaUrl,
            badgeText: sponsor.badgeText,
            active: sponsor.active,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('Firestore sponsor sync skipped:', path, err);
      }
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        signingIn,
        billing,
        refreshBilling,
        signInWithGoogle,
        logout,
        syncLinkToFirestore,
        syncSponsorToFirestore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
