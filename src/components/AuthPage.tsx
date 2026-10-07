import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "../firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { setDoc, doc, getDoc } from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import {
  Wallet,
  Mail,
  Shield,
  Check,
  Loader2,
  ArrowRight,
  Chrome,
  User,
  Lock,
  Sparkles,
  HelpCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import GoogleIcon from "./GoogleIcon";
import MicaBrandPanel from "./auth/MicaBrandPanel";
import PoweredByMarquee from "./auth/PoweredByMarquee";
import { usePrivy } from "@privy-io/react-auth";

// @ts-ignore
import spaceGirlBg from "../assets/images/anime_space_girl_bg_1782060437755.jpg";

interface AuthPageProps {
  onAuthSuccess: (user: any) => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Email form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");

  // Visual-only: tracks which input is focused for glass glow effect
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // System setup info collapsibility
  const [showFirebaseSetup, setShowFirebaseSetup] = useState(false);

  // Privy Wallet Auth
  const { login, authenticated, user, ready } = usePrivy();
  const [privyBridgeLoading, setPrivyBridgeLoading] = useState(false);
  const bridgedRef = useRef(false);

  // Bridge Privy authentication to Firebase auth
  useEffect(() => {
    if (!authenticated || !user || !ready || bridgedRef.current) return;
    bridgedRef.current = true;

    const bridgePrivyToFirebase = async () => {
      setPrivyBridgeLoading(true);
      setError("");

      try {
        const linkedWallet = user.linkedAccounts?.find(
          (a) => a.type === "wallet"
        ) as { address?: string } | undefined;
        const walletAddress = user.wallet?.address || linkedWallet?.address;

        if (!walletAddress) {
          throw new Error("No wallet address found. Please connect a wallet.");
        }

        const emailSeed = `privy_${walletAddress.toLowerCase()}@privy.auth`;
        const pwdSeed = `PrivyBridge_${walletAddress.substring(2, 10)}_Secure`;

        let userCredential;
        try {
          userCredential = await signInWithEmailAndPassword(auth, emailSeed, pwdSeed);
        } catch (signInErr: any) {
          if (signInErr.code === "auth/user-not-found" || signInErr.code === "auth/invalid-credential") {
            userCredential = await createUserWithEmailAndPassword(auth, emailSeed, pwdSeed);
          } else {
            throw signInErr;
          }
        }

        const uid = userCredential.user.uid;
        const profileDoc = await getDoc(doc(db, "users", uid));
        let profile;

        if (profileDoc.exists()) {
          profile = profileDoc.data();
        } else {
          const shortAddr = `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`;
          profile = {
            uid,
            username: `user_${walletAddress.substring(2, 10).toLowerCase()}`,
            displayName: `Wallet (${shortAddr})`,
            walletAddress: walletAddress.toLowerCase(),
            avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${walletAddress.toLowerCase()}`,
            status: "online",
            lastActive: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            onboardingCompleted: false,
          };
          await setDoc(doc(db, "users", uid), profile);
        }

        onAuthSuccess({ ...userCredential.user, profile });
      } catch (err: any) {
        console.error("Privy bridge error:", err);
        setError(err.message || "Failed to complete wallet authentication.");
      } finally {
        setPrivyBridgeLoading(false);
      }
    };

    bridgePrivyToFirebase();
  }, [authenticated, user, ready]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isLogin) {
        // Sign In
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // Fetch profile
        const userDoc = await getDoc(doc(db, "users", userCredential.user.uid));
        if (userDoc.exists()) {
          onAuthSuccess({ ...userCredential.user, profile: userDoc.data() });
        } else {
          // If profile is missing, create a generic one and route to onboarding
          const defaultProfile = {
            uid: userCredential.user.uid,
            username: email.split("@")[0].toLowerCase() + Math.floor(Math.random() * 1000),
            displayName: email.split("@")[0],
            avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${userCredential.user.uid}`,
            status: "online",
            lastActive: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            onboardingCompleted: false,
          };
          await setDoc(doc(db, "users", userCredential.user.uid), defaultProfile);
          onAuthSuccess({ ...userCredential.user, profile: defaultProfile });
        }
      } else {
        // Sign Up
        if (!username) {
          throw new Error("Username is required");
        }
        if (username.length < 3 || username.length > 32) {
          throw new Error("Username must be between 3 and 32 characters");
        }

        const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (cleanUsername !== username.toLowerCase()) {
          throw new Error("Username can only contain alphanumeric characters and underscores");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match");
        }

        // Create Auth Account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        // Save Firestore Profile (Duplicate username to displayName for simplified clean layout)
        // Every account routes through wallet-required onboarding before the dashboard.
        const profile = {
          uid,
          username: cleanUsername,
          displayName: username.trim(),
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          status: "online",
          lastActive: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          onboardingCompleted: false,
        };

        await setDoc(doc(db, "users", uid), profile);
        onAuthSuccess({ ...userCredential.user, profile });
      }
    } catch (err: any) {
      console.error("Authentication error:", err);
      let errMsg = err.message;
      if (err.code === "auth/email-already-in-use") {
        errMsg = "This email is already in use.";
      } else if (err.code === "auth/weak-password") {
        errMsg = "Password must be at least 6 characters.";
      } else if (err.code === "auth/invalid-email") {
        errMsg = "Invalid email format.";
      } else if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        errMsg = "Invalid email or password.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const userCredential = await signInWithPopup(auth, provider);
      const uid = userCredential.user.uid;

      const profileDoc = await getDoc(doc(db, "users", uid));
      let profile;

      if (profileDoc.exists()) {
        profile = profileDoc.data();
      } else {
        const userEmail = userCredential.user.email || "";
        profile = {
          uid,
          username: userEmail ? userEmail.split("@")[0].toLowerCase() + Math.floor(Math.random() * 100) : `user_${uid.substring(0, 8)}`,
          displayName: userCredential.user.displayName || "Google User",
          avatarUrl: userCredential.user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          status: "online",
          lastActive: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          onboardingCompleted: false,
        };
        await setDoc(doc(db, "users", uid), profile);
      }

      onAuthSuccess({ ...userCredential.user, profile });
    } catch (err: any) {
      console.error("Google authentication error:", err);
      let errMsg = err.message;
      if (err.code === "auth/operation-not-allowed") {
        errMsg = "Google Sign-In is not enabled on this platform. Please enable it in the Firebase Console.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleWalletClick = () => {
    setError("");
    login();
  };

  return (
    <div id="auth_container" className="min-h-[100dvh] w-full flex bg-[#0B0F17] text-white overflow-hidden select-none relative">

      {/* LEFT - branding artwork panel (visual only, hidden on mobile) */}
      <MicaBrandPanel />

      {/* RIGHT - login form: open, minimal, no card */}
      <main className="relative flex flex-1 min-h-[100dvh] flex-col items-center justify-center overflow-y-auto custom-scrollbar px-6 pt-14 pb-36 sm:px-10 sm:pb-40">

        {/* Subtle purple/blue ambience behind the form */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(65% 45% at 50% 0%, rgba(108,92,224,0.14) 0%, transparent 70%)," +
              "radial-gradient(55% 40% at 50% 100%, rgba(37,99,235,0.08) 0%, transparent 75%)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-[400px]"
        >
          {/* Header */}
          <div className="text-center">
            <motion.h1
              key={isLogin ? "signin" : "signup"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-[30px] sm:text-[36px] font-semibold tracking-tight text-white leading-tight"
            >
              {isLogin ? "Log in to MICA" : "Create your account"}
            </motion.h1>

            <p className="mt-2 text-sm font-normal tracking-wide text-zinc-500">
              {isLogin ? "Sign in to your account" : "Get started with your free account"}
            </p>
          </div>

          {/* Error Notification */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className="mt-6 flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 relative z-20"
                id="auth_error_container"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400 mt-0.5">
                  <HelpCircle className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white">Error</h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{error}</p>
                </div>
                <button
                  onClick={() => setError("")}
                  className="px-1.5 py-0.5 text-xs font-bold text-zinc-500 transition-colors hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Social Authentication Buttons */}
          <div className="mt-8 space-y-3">
            {/* Continue with Google */}
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              id="google_signin_btn"
              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 cursor-pointer transition-all duration-200 hover:border-white/15 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <GoogleIcon className="h-[18px] w-[18px] shrink-0" />
                <span className="text-sm font-medium text-zinc-200 transition-colors group-hover:text-white whitespace-nowrap">
                  Continue with Google
                </span>
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors group-hover:text-white">
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
              </span>
            </motion.button>

            {/* Continue with Wallet / Privy Web3 */}
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleWalletClick}
              disabled={loading || privyBridgeLoading}
              id="privy_oauth_btn"
              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 cursor-pointer transition-all duration-200 hover:border-white/15 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <Wallet className="h-[18px] w-[18px] shrink-0 text-[#8B7FF0]" />
                <span className="text-sm font-medium text-zinc-200 transition-colors group-hover:text-white whitespace-nowrap">
                  Continue with Wallet
                </span>
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors group-hover:text-white">
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </motion.button>
          </div>

          {/* OR Divider */}
          <div className="my-7 flex items-center justify-center">
            <span className="h-px flex-1 bg-white/10" />
            <span className="px-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 select-none">
              OR
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3">

            {/* Email Address */}
            <div
              className={`rounded-xl border bg-white/[0.03] px-4 py-3 transition-all duration-200 ${
                focusedField === "email"
                  ? "border-[#6C5CE0]/60 ring-2 ring-[#6C5CE0]/15"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 select-none">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                placeholder="Enter your email address"
                className="mt-1 w-full bg-transparent text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none tracking-tight"
              />
            </div>

            {/* Username - SignUp Only */}
            {!isLogin && (
              <div
                className={`rounded-xl border bg-white/[0.03] px-4 py-3 transition-all duration-200 ${
                  focusedField === "username"
                    ? "border-[#6C5CE0]/60 ring-2 ring-[#6C5CE0]/15"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 select-none">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="choose a username"
                  className="mt-1 w-full bg-transparent text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none tracking-tight"
                />
              </div>
            )}

            {/* Password */}
            <div
              className={`rounded-xl border bg-white/[0.03] px-4 py-3 transition-all duration-200 ${
                focusedField === "password"
                  ? "border-[#6C5CE0]/60 ring-2 ring-[#6C5CE0]/15"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 select-none">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                placeholder="Enter your password"
                className="mt-1 w-full bg-transparent text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none tracking-tight"
              />
            </div>

            {/* Confirm Password - SignUp Only */}
            {!isLogin && (
              <div
                className={`rounded-xl border bg-white/[0.03] px-4 py-3 transition-all duration-200 ${
                  focusedField === "confirmPassword"
                    ? "border-[#6C5CE0]/60 ring-2 ring-[#6C5CE0]/15"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 select-none">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setFocusedField("confirmPassword")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="confirm password"
                  className="mt-1 w-full bg-transparent text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none tracking-tight"
                />
              </div>
            )}

            {/* Submit Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              id="standard_auth_submit"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#6C5CE0] px-5 py-3.5 text-sm font-semibold text-white cursor-pointer transition-colors duration-200 hover:bg-[#7A6BE8] disabled:opacity-60 disabled:hover:scale-100"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {isLogin ? "Log in" : "Create account"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Footer - Sign In / Sign Up toggle */}
          <div className="mt-7 text-center text-[13px] text-zinc-500 font-medium">
            {isLogin ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setIsLogin(false);
                  }}
                  className="ml-0.5 font-semibold text-[#8B7FF0] transition-colors hover:text-[#A79BF2] cursor-pointer hover:underline"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setIsLogin(true);
                  }}
                  className="ml-0.5 font-semibold text-[#8B7FF0] transition-colors hover:text-[#A79BF2] cursor-pointer hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </motion.div>

        {/* BOTTOM - subtle "Powered by" tech-stack marquee (visual only) */}
        <PoweredByMarquee />
      </main>
    </div>
  );
}
