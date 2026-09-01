import { HOLD } from './config';

/**
 * The arrival state. The markup lives in index.html so the field sits on the
 * real grid (columns 7–11) rather than being positioned from JS; this class
 * only wires behaviour: reveal on resolve, submit, and the example prompts.
 */
export class Arrival {
  private root: HTMLElement;
  private field: HTMLElement;
  private input: HTMLInputElement;
  private chipRow: HTMLElement;
  private shown = false;

  /** Wired by main; also the public `onSubmit(text)` hook. */
  onSubmit: (text: string) => void = () => {};

  constructor() {
    this.root = document.getElementById('arrival')!;
    this.field = document.getElementById('arrivalField')!;
    this.input = document.getElementById('arrivalInput') as HTMLInputElement;
    this.chipRow = document.getElementById('arrivalChips')!;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not drive the scene
      if (e.key === 'Enter') this.submit(this.input.value);
    });
    this.input.addEventListener('input', () => {
      // the enter glyph brightens once there is something to send
      this.field.classList.toggle('has-text', this.input.value.trim().length > 0);
    });
    // the canvas hides the system cursor; restore a real one over the field
    this.field.addEventListener('pointerenter', () => (document.body.style.cursor = 'text'));
    this.field.addEventListener('pointerleave', () => (document.body.style.cursor = ''));
    this.field.addEventListener('pointerdown', (e) => e.stopPropagation());

    for (const prompt of HOLD.demo.examplePrompts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = prompt;
      chip.addEventListener('pointerdown', (e) => e.stopPropagation());
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.submit(prompt);
      });
      this.chipRow.appendChild(chip);
    }
  }

  private submit(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.input.value = '';
    this.field.classList.remove('has-text');
    this.input.blur();
    this.onSubmit(t);
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.add('is-visible');
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('is-visible');
    this.input.value = '';
    this.field.classList.remove('has-text');
  }

  get visible(): boolean {
    return this.shown;
  }
}
