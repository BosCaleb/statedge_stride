import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The size at which to show a frame inside `box`: the box's width, or less for a tall frame so
 * that it takes at most `maxHeightShare` of the screen height. Follows the box as it resizes.
 */
export function useFitSize(
  box: RefObject<HTMLElement | null>,
  frame: { width: number; height: number },
  maxHeightShare = 0.7,
): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width || frame.width;
      const maxH = window.innerHeight * maxHeightShare || frame.height;
      let w = width;
      let h = (w * frame.height) / frame.width;
      if (h > maxH) {
        h = maxH;
        w = (h * frame.width) / frame.height;
      }
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [box, frame.width, frame.height, maxHeightShare]);
  return size;
}
