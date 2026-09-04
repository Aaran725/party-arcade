/** Shared streak tracker for the three round-based games (reaction-buzzer, simon-says, trivia-buzzer). */
export class ComboTracker {
  private streak = 0;

  registerWin(): number {
    this.streak += 1;
    return this.streak;
  }

  registerMiss(): void {
    this.streak = 0;
  }

  get current(): number {
    return this.streak;
  }

  get multiplier(): number {
    return 1 + Math.min(this.streak - 1, 4) * 0.25;
  }
}
