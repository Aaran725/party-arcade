import { el } from "@shared/dom";

export function renderJoinScreen(
  root: HTMLElement,
  opts: { roomCode: string; error?: string; onJoin: (name: string) => void },
): void {
  const input = el("input", { class: "glass-input", placeholder: "Your name", maxlength: 16, autocomplete: "off" }) as HTMLInputElement;
  const joinBtn = el("button", { class: "glass-button accent" }, ["Join room"]);

  const submit = () => {
    if (joinBtn.hasAttribute("disabled")) return;
    const name = input.value.trim();
    if (!name) return;
    joinBtn.setAttribute("disabled", "");
    joinBtn.classList.add("loading");
    opts.onJoin(name);
  };
  joinBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  root.replaceChildren(
    el("div", { class: "glass-panel controller-panel anim-pop-in" }, [
      el("h1", { class: "title-lg" }, ["Party Arcade"]),
      el("p", { class: "glass-pill mono", style: "align-self:center" }, [opts.roomCode]),
      input,
      joinBtn,
      ...(opts.error ? [el("p", { class: "text-body anim-shake", style: "color:var(--accent-2)" }, [opts.error])] : []),
      el("a", { href: "/trust", target: "_blank", rel: "noopener", class: "text-caption", style: "text-align:center;text-decoration:underline" }, [
        "Getting this warning every party? Fix it once →",
      ]),
    ]),
  );

  setTimeout(() => input.focus(), 50);
}
