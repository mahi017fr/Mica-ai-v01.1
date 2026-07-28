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
        const walletAddress = user.wallet?.address ||
          user.linkedAccounts?.find(
            (a: any) => a.type === "wallet" || a.type === "ethereum_wallet"
          )?.address;

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
          // If profile is missing, create a generic one
          const defaultProfile = {
            uid: userCredential.user.uid,
            username: email.split("@")[0].toLowerCase() + Math.floor(Math.random() * 1000),
            displayName: email.split("@")[0],
            avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${userCredential.user.uid}`,
            status: "online",
            lastActive: new Date().toISOString(),
            createdAt: new Date().toISOString(),
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
        const profile = {
          uid,
          username: cleanUsername,
          displayName: username.trim(),
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
          status: "online",
          lastActive: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          onboardingCompleted: true,
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
      
      {/* FULL-WIDTH CENTERED FORM */}
      <div className="w-full flex flex-col justify-center items-center p-6 sm:p-12 relative z-10 bg-[#0B0F17] overflow-y-auto custom-scrollbar min-h-[100dvh]">
        
        {/* Center Glass Card Container — Visual design from GlassLoginCard */}
        <div className="py-0 w-full max-w-[430px] sm:max-w-[450px] relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full"
          >
            <div className="w-full p-8 sm:p-10 rounded-[34px] sm:rounded-[40px] backdrop-blur-3xl bg-glass-card glass-border relative overflow-hidden shadow-2xl transition-all duration-300">
              
              {/* Prismatic Chromatic Light Streak along top edge */}
              <div className="absolute top-0 left-0 right-0 h-[2px] glass-chromatic-edge opacity-80 pointer-events-none" />

              {/* Top-Left Chromatic Prismatic Light Flare */}
              <div className="absolute -top-12 -left-12 w-48 h-48 bg-gradient-to-br from-emerald-400/35 via-cyan-400/20 to-transparent rounded-full blur-3xl pointer-events-none" />
              <div className="absolute top-0 left-6 w-32 h-[1px] bg-gradient-to-r from-emerald-300/80 via-cyan-300/60 to-transparent blur-[0.5px] pointer-events-none" />

              {/* Diagonal Specular Sheen Layer */}
              <div className="absolute inset-0 glass-shine pointer-events-none opacity-90" />

              {/* Card Header */}
              <div className="relative z-10 text-center">
                <motion.h1 
                  key={isLogin ? "signin" : "signup"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-3xl sm:text-[36px] font-bold tracking-tight text-white flex items-center justify-center gap-2 font-['Outfit']"
                >
                  {isLogin ? (
                    <>
                      <span className="font-semibold text-white tracking-tight">Welcome</span>
                      <span className="text-zinc-400/90 font-normal tracking-tight">back</span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-white tracking-tight">Create</span>
                      <span className="text-zinc-400/90 font-normal tracking-tight">account</span>
                    </>
                  )}
                </motion.h1>

                <p className="text-zinc-400 text-sm mt-2 font-normal tracking-wide">
                  {isLogin ? "Sign in to your account" : "Get started with your free account"}
                </p>
              </div>

              {/* Error Notification — styled as glass toast */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -12, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.25 }}
                    className="mt-6 p-4 rounded-2xl bg-red-950/30 border border-red-500/30 backdrop-blur-2xl shadow-2xl flex items-start gap-3 relative z-20"
                    id="auth_error_container"
                  >
                    <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                      <HelpCircle className="w-4 h-4 stroke-[3]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-white">Error</h4>
                      <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{error}</p>
                    </div>
                    <button
                      onClick={() => setError("")}
                      className="text-zinc-500 hover:text-white text-xs font-bold px-1.5 py-0.5 cursor-pointer transition-colors"
                    >
                      ✕
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Social Authentication Buttons */}
              <div className="relative z-10 space-y-3.5 mt-7">
                {/* Continue with Google */}
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  id="google_signin_btn"
                  className="w-full glass-btn rounded-[22px] py-3.5 px-5 flex items-center justify-between transition-all duration-200 cursor-pointer group border border-white/5"
                >
                  <div className="flex items-center gap-3.5">
                    <GoogleIcon className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors whitespace-nowrap">
                      {isLogin ? "Sign in with Google" : "Sign up with Google"}
                    </span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#252938] group-hover:bg-[#2f3548] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all">
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                    ) : (
                      <ArrowRight className="w-4 h-4 stroke-[2]" />
                    )}
                  </div>
                </motion.button>

                {/* Continue with Wallet / Privy Web3 */}
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleWalletClick}
                  disabled={loading || privyBridgeLoading}
                  id="privy_oauth_btn"
                  className="w-full glass-btn rounded-[22px] py-3.5 px-5 flex items-center justify-between transition-all duration-200 cursor-pointer group border border-white/5"
                >
                  <div className="flex items-center gap-3.5">
                    <Wallet className="w-5 h-5 shrink-0 text-cyan-400" />
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors whitespace-nowrap">
                      Continue with Wallet
                    </span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#252938] group-hover:bg-[#2f3548] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all">
                    <ArrowRight className="w-4 h-4 stroke-[2]" />
                  </div>
                </motion.button>
              </div>

              {/* OR Divider */}
              <div className="relative z-10 my-7 flex items-center justify-center">
                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/10" />
                <span className="text-[11px] text-zinc-500 font-semibold tracking-widest px-4 uppercase select-none">
                  OR
                </span>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-white/10 via-white/10 to-transparent" />
              </div>

              {/* Email Form — Visual from GlassLoginCard, logic from AuthPage */}
              <form onSubmit={handleEmailAuth} className="relative z-10 space-y-3.5">
                
                {/* Email Address */}
                <div 
                  className={`glass-input rounded-[22px] p-3.5 px-4.5 transition-all duration-300 border ${
                    focusedField === "email" 
                      ? "border-cyan-400/50 ring-2 ring-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" 
                      : "border-white/10 hover:border-white/15"
                  }`}
                >
                  <label className="block text-[11px] text-zinc-400/90 font-semibold tracking-wider uppercase select-none">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField("email")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="name@example.com"
                    className="w-full bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-zinc-600 tracking-tight mt-0.5"
                  />
                </div>

                {/* Username — SignUp Only */}
                {!isLogin && (
                  <div 
                    className={`glass-input rounded-[22px] p-3.5 px-4.5 transition-all duration-300 border ${
                      focusedField === "username" 
                        ? "border-cyan-400/50 ring-2 ring-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" 
                        : "border-white/10 hover:border-white/15"
                    }`}
                  >
                    <label className="block text-[11px] text-zinc-400/90 font-semibold tracking-wider uppercase select-none">
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
                      className="w-full bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-zinc-600 tracking-tight mt-0.5"
                    />
                  </div>
                )}

                {/* Password */}
                <div 
                  className={`glass-input rounded-[22px] p-3.5 px-4.5 transition-all duration-300 border ${
                    focusedField === "password" 
                      ? "border-cyan-400/50 ring-2 ring-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" 
                      : "border-white/10 hover:border-white/15"
                  }`}
                >
                  <label className="block text-[11px] text-zinc-400/90 font-semibold tracking-wider uppercase select-none">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField("password")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="enter password"
                    className="w-full bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-zinc-600 tracking-tight mt-0.5"
                  />
                </div>

                {/* Confirm Password — SignUp Only */}
                {!isLogin && (
                  <div 
                    className={`glass-input rounded-[22px] p-3.5 px-4.5 transition-all duration-300 border ${
                      focusedField === "confirmPassword" 
                        ? "border-cyan-400/50 ring-2 ring-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" 
                        : "border-white/10 hover:border-white/15"
                    }`}
                  >
                    <label className="block text-[11px] text-zinc-400/90 font-semibold tracking-wider uppercase select-none">
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
                      className="w-full bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-zinc-600 tracking-tight mt-0.5"
                    />
                  </div>
                )}

                {/* Submit Button */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  type="submit"
                  disabled={loading}
                  id="standard_auth_submit"
                  className="w-full rounded-[22px] py-3.5 px-5 bg-gradient-to-tr from-[#10b981] via-[#06b6d4] to-[#38bdf8] flex items-center justify-center gap-2 cursor-pointer text-slate-950 font-bold disabled:opacity-75 disabled:hover:scale-100 transition-all duration-200 mt-6"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-950 stroke-[2.5]" />
                  ) : (
                    <>
                      {isLogin ? "Sign In" : "Sign Up"}
                      <ArrowRight className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                    </>
                  )}
                </motion.button>
              </form>

              {/* Card Footer — Sign In / Sign Up toggle */}
              <div className="relative z-10 mt-9 text-center text-xs text-zinc-400 font-medium">
                {isLogin ? (
                  <>
                    Don't have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setIsLogin(false);
                      }}
                      className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors ml-0.5 cursor-pointer hover:underline"
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
                      className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors ml-0.5 cursor-pointer hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>

            </div>
          </motion.div>
        </div>

      </div>


    </div>
  );
}
