import { el } from "@shared/dom";

/**
 * The "you did something, now wait" moment every vote/submit/buzz-in game hits — until
 * now each game copy-pasted its own "Waiting for the results…" boilerplate with an
 * identical generic look. One shared card, one icon + label per call site, so "you voted
 * Bob" and "buzzed in, waiting on the artist" actually read as distinct moments.
 */
export function renderAnsweredCard(root: HTMLElement, opts: { icon: string; label: string; sub?: string }): void {
  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in", style: "align-items:center" }, [
      el("div", { class: "answered-icon anim-pulse" }, [opts.icon]),
      el("h2", { class: "title-md" }, [opts.label]),
      ...(opts.sub ? [el("p", { class: "text-body" }, [opts.sub])] : []),
    ]),
  );
}
