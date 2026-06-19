import { motion as Motion } from "framer-motion";

export default function PageTransition({ children }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.99 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="min-h-screen"
    >
      {children}
    </Motion.div>
  );
}
