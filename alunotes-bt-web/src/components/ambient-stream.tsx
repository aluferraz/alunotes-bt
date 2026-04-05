"use client";

import { motion } from "framer-motion";

export function AmbientStream() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none bg-background transition-colors duration-500">
      <motion.div
        className="absolute top-1/4 -left-[20vw] w-[80vw] h-[60vh] rounded-full blur-[140px] opacity-30 mix-blend-screen"
        style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 80%)" }}
        animate={{
          x: [0, 100, 0],
          y: [0, 50, -20, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
      />
      
      <motion.div
        className="absolute top-1/3 -right-[10vw] w-[70vw] h-[50vh] rounded-full blur-[120px] opacity-25 mix-blend-screen"
        style={{ background: "radial-gradient(circle, var(--secondary) 0%, transparent 80%)" }}
        animate={{
          x: [0, -120, 0],
          y: [0, -60, 40, 0],
        }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      />

      <motion.div
        className="absolute -bottom-1/4 left-[10vw] w-[100vw] h-[60vh] rounded-full blur-[150px] opacity-20 mix-blend-screen"
        style={{ background: "radial-gradient(circle, var(--tertiary) 0%, transparent 80%)" }}
        animate={{
          x: [0, 50, -50, 0],
          y: [0, -100, 0],
        }}
        transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
