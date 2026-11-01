import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { SectorMark } from "./components/SectorMark";
import { ThemeToggle } from "./components/ThemeToggle";
import { LoadingBlock } from "./components/ui";
import SessionsPage from "./pages/SessionsPage";

const SessionPage = lazy(() => import("./pages/SessionPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const ProgressPage = lazy(() => import("./pages/ProgressPage"));

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `relative px-1 py-5 font-display text-[14px] font-semibold uppercase tracking-[0.1em] sm:text-[15px] sm:tracking-[0.12em] transition-colors ${
          isActive ? "text-bone" : "text-mute hover:text-bone-dim"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive && (
            <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-px h-[2px] bg-signal" />
          )}
        </>
      )}
    </NavLink>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-5 px-4 sm:gap-10 sm:px-8">
          <NavLink to="/" className="flex items-center gap-3">
            <SectorMark />
            <span className="hidden leading-none sm:block">
              <span className="block font-display text-[19px] font-bold uppercase tracking-[0.18em]">Pit Wall</span>
              <span className="label block !text-[10px] !tracking-[0.22em]">LMU Telemetry</span>
            </span>
          </NavLink>
          <nav className="flex gap-5 sm:gap-7">
            <NavItem to="/">Sessions</NavItem>
            <NavItem to="/compare">Compare</NavItem>
            <NavItem to="/progress">Progress</NavItem>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 sm:px-8"
        >
          <Suspense fallback={<LoadingBlock />}>
            <Routes location={location}>
              <Route path="/" element={<SessionsPage />} />
              <Route path="/sessions/:id" element={<SessionPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/progress" element={<ProgressPage />} />
            </Routes>
          </Suspense>
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
