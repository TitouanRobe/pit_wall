import { AnimatePresence, motion } from "framer-motion";
import { useMode } from "../lib/mode";

export function ThemeToggle() {
  const { mode, toggle } = useMode();
  const next = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-bone-dim transition-colors hover:border-line-strong hover:text-bone"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={mode}
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0, rotate: -50, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 50, scale: 0.8 }}
          transition={{ duration: 0.14 }}
          aria-hidden
        >
          {mode === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </>
          ) : (
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          )}
        </motion.svg>
      </AnimatePresence>
    </button>
  );
}
