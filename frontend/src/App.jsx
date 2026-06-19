import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";

import ConnectWallet from "./pages/auth/ConnectWallet";
import VerifyEmail from "./pages/auth/VerifyEmail";
import Dashboard from "./pages/dashboard/Dashboard";
import BrowsePapers from "./pages/browse/BrowsePapers";
import ReviewWorkspace from "./pages/review/ReviewWorkspace";
import AuthorWorkspace from "./pages/author/AuthorWorkspace";
import LandingPage from "./pages/LandingPage";
import LearnMore from "./pages/LearnMore";
import PaperDetails from "./pages/paper/PaperDetails";

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth/connect-wallet" element={<ConnectWallet />} />
        <Route path="/auth/verify-email" element={<VerifyEmail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/author-workspace" element={<AuthorWorkspace />} />
        <Route path="/browse-papers" element={<BrowsePapers />} />
        <Route path="/paper/:paperId" element={<PaperDetails />} />
        <Route path="/review-workspace" element={<ReviewWorkspace />} />
        <Route path="/learn-more" element={<LearnMore />} />
      </Routes>
    </AnimatePresence>
  );
}
