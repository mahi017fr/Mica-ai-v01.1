import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import GoogleIcon from "./GoogleIcon";

export default function GlassLoginCard() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "info";
    title: string;
    message: string;
  } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setNotification({
        type: "info",
        title: "Invalid Email",
        message: "Please enter a valid email address.",
      });
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setNotification({
        type: "success",
        title: mode === "signin" ? "Magic Link Sent!" : "Account Created!",
        message:
          mode === "signin"
            ? `We sent a magic sign-in link to ${email}. Check your inbox!`
            : `Welcome aboard! Check ${email} to verify your account.`,
      });
    }, 1100);
  };

  const handleSocialLogin = (provider: "Google" | "Wallet") => {
    setLoadingProvider(provider);
    setTimeout(() => {
      setLoadingProvider(null);
      setNotification({
        type: "success",
        title: `Authenticating with ${provider}`,
        message: `Successfully connected with your ${provider}! Redirecting...`,
      });
    }, 1100);
  };

  const toggleMode = () => {
    setMode((prev) => (prev === "signin" ? "signup" : "signin"));
    setNotification(null);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-10 w-full max-w-[430px] sm:max-w-[450px] px-3 sm:px-0"
    >
      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="mb-4 p-4 rounded-2xl bg-[#161a25]/95 border border-emerald-500/30 backdrop-blur-2xl shadow-2xl flex items-start gap-3 relative z-20"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-4 h-4 stroke-[3]" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-white">{notification.title}</h4>
              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-zinc-500 hover:text-white text-xs font-bold px-1.5 py-0.5 cursor-pointer transition-colors"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Glass Card Container */}
      <div className="w-full p-8 sm:p-10 rounded-[34px] sm:rounded-[40px] backdrop-blur-3xl bg-glass-card glass-border relative overflow-hidden shadow-2xl transition-all duration-300">
        
        {/* Prismatic Chromatic Light Streak along top edge */}
        <div className="absolute top-0 left-0 right-0 h-[2px] glass-chromatic-edge opacity-80 pointer-events-none" />

        {/* Top-Left Chromatic Prismatic Light Flare (Matches screenshot exactly) */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-gradient-to-br from-emerald-400/35 via-cyan-400/20 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 left-6 w-32 h-[1px] bg-gradient-to-r from-emerald-300/80 via-cyan-300/60 to-transparent blur-[0.5px] pointer-events-none" />

        {/* Diagonal Specular Sheen Layer */}
        <div className="absolute inset-0 glass-shine pointer-events-none opacity-90" />

        {/* Card Header */}
        <div className="relative z-10 text-center">
          <motion.h1 
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-3xl sm:text-[36px] font-bold tracking-tight text-white flex items-center justify-center gap-2 font-['Outfit']"
          >
            {mode === "signin" ? (
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
            {mode === "signin" ? "Sign in to your account" : "Get started with your free account"}
          </p>
        </div>

        {/* Email Input Form */}
        <form onSubmit={handleSubmit} className="relative z-10 mt-8 sm:mt-9">
          <div 
            className={`relative glass-input rounded-[22px] p-3.5 px-4.5 flex items-center justify-between transition-all duration-300 border ${
              isFocused 
                ? "border-cyan-400/50 ring-2 ring-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]" 
                : "border-white/10 hover:border-white/15"
            }`}
          >
            <div className="flex-1 min-w-0 mr-3">
              <label htmlFor="email-input" className="block text-[11px] text-zinc-400/90 font-semibold tracking-wider uppercase select-none">
                Email
              </label>
              <div className="relative flex items-center mt-0.5">
                <input
                  id="email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="name@example.com"
                  required
                  className="w-full bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-zinc-600 tracking-tight"
                />
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              type="submit"
              disabled={isLoading}
              title="Submit Email"
              className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#10b981] via-[#06b6d4] to-[#38bdf8] flex items-center justify-center shrink-0 glow-button cursor-pointer text-slate-950 font-bold disabled:opacity-75 disabled:hover:scale-100 transition-all duration-200"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-950 stroke-[2.5]" />
              ) : (
                <ArrowRight className="w-5 h-5 text-slate-950 stroke-[2.5]" />
              )}
            </motion.button>
          </div>
        </form>

        {/* OR Divider */}
        <div className="relative z-10 my-7 flex items-center justify-center">
          <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/10" />
          <span className="text-[11px] text-zinc-500 font-semibold tracking-widest px-4 uppercase select-none">
            OR
          </span>
          <div className="h-[1px] flex-1 bg-gradient-to-r from-white/10 via-white/10 to-transparent" />
        </div>

        {/* Social Authentication Buttons */}
        <div className="relative z-10 space-y-3.5">
          {/* Continue with Google */}
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => handleSocialLogin("Google")}
            disabled={loadingProvider !== null}
            className="w-full glass-btn rounded-[22px] py-3.5 px-5 flex items-center justify-between transition-all duration-200 cursor-pointer group border border-white/5"
          >
            <div className="flex items-center gap-3.5">
              <GoogleIcon className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                Continue with Google
              </span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#252938] group-hover:bg-[#2f3548] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all">
              {loadingProvider === "Google" ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              ) : (
                <ArrowRight className="w-4 h-4 stroke-[2]" />
              )}
            </div>
          </motion.button>

          {/* Continue with Wallet */}
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => handleSocialLogin("Wallet")}
            disabled={loadingProvider !== null}
            className="w-full glass-btn rounded-[22px] py-3.5 px-5 flex items-center justify-between transition-all duration-200 cursor-pointer group border border-white/5"
          >
            <div className="flex items-center gap-3.5">
              <Wallet className="w-5 h-5 shrink-0 text-cyan-400" />
              <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                Continue with Wallet
              </span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#252938] group-hover:bg-[#2f3548] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all">
              {loadingProvider === "Wallet" ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              ) : (
                <ArrowRight className="w-4 h-4 stroke-[2]" />
              )}
            </div>
          </motion.button>
        </div>

        {/* Card Footer */}
        <div className="relative z-10 mt-9 text-center text-xs text-zinc-400 font-medium">
          {mode === "signin" ? (
            <>
              Don’t have an account?{" "}
              <button
                type="button"
                onClick={toggleMode}
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
                onClick={toggleMode}
                className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors ml-0.5 cursor-pointer hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

