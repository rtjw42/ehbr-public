import { useEffect } from "react";

// Body scroll lock for modals/overlays. Reference-counted so nested overlays don't
// unlock each other (only the last release restores scrolling), and it pads for the
// scrollbar's width so the page doesn't shift when the bar disappears.
//
// These are the only files permitted to mutate body/html/#root styles.
// Do not call document.body.style or document.documentElement.style anywhere else.
let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";

// Release any body lock left over from a previous HMR module execution so the
// page doesn't stay frozen after a hot reload in dev.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (lockCount > 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    }
  });
}

const getScrollbarWidth = () => Math.max(0, window.innerWidth - document.documentElement.clientWidth);

const lockBodyScroll = () => {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = getScrollbarWidth();

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
  }

  lockCount += 1;
};

const unlockBodyScroll = () => {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;

  document.body.style.overflow = previousOverflow;
  document.body.style.paddingRight = previousPaddingRight;
  previousOverflow = "";
  previousPaddingRight = "";
};

export const useScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
};
