// ── Cascade ──────────────────────────────────────────────────────────────────
// Full-tier "deal-in" reveal for grid/list items — each item fades + rises in
// one-by-one (staggered by index). Self-gates on the motion tier: a no-op on
// lite (the item just appears), so callers don't thread an `active` flag
// through. Only transform+opacity animate → stays on the GPU. The booking page
// wraps its day cards in <CascadeItem>.
import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { cascadeItemProps } from "@/lib/motion";
import { useMotionTier } from "@/hooks/useMotionTier";

export const CascadeItem = ({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) => {
  // Desktop (full) only; the coarse-pointer tier (lite) renders items at rest.
  const active = useMotionTier() === "full";
  return (
    <motion.div className={className} {...cascadeItemProps(index, active)}>
      {children}
    </motion.div>
  );
};
