/**
 * Shared scrub position for a ride view.
 *
 * Deliberately NOT React state. Hovering a chart fires on every mousemove, and
 * routing that through a re-render would repaint the map, every chart, and the
 * whole stat header at pointer rate. Subscribers here update their own DOM node
 * or map marker imperatively instead, which is what keeps scrubbing at 60fps on
 * a 7,000-sample ride.
 */

export type CursorListener = (index: number | null) => void;

export class CursorStore {
  #index: number | null = null;
  #listeners = new Set<CursorListener>();
  #frame: number | null = null;
  #pending: number | null = null;
  #hasPending = false;

  get index(): number | null {
    return this.#index;
  }

  subscribe(listener: CursorListener): () => void {
    this.#listeners.add(listener);
    listener(this.#index);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Coalesce to one update per animation frame. Pointer events can outpace the
   * compositor, and there is no value in painting a marker twice in one frame.
   */
  set(index: number | null): void {
    if (index === this.#index && !this.#hasPending) return;
    this.#pending = index;
    this.#hasPending = true;
    if (this.#frame !== null) return;

    if (typeof requestAnimationFrame === "undefined") {
      this.#flush();
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#flush();
    });
  }

  #flush(): void {
    if (!this.#hasPending) return;
    this.#hasPending = false;
    const next = this.#pending;
    if (next === this.#index) return;
    this.#index = next;
    for (const listener of this.#listeners) listener(next);
  }

  destroy(): void {
    if (this.#frame !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.#frame);
    }
    this.#frame = null;
    this.#listeners.clear();
  }
}

/** Inclusive sample range currently selected by dragging on a chart. */
export interface Selection {
  from: number;
  to: number;
}
