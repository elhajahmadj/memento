import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-project-selection',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="splash">
      <div class="brand">
        <div class="logo">▶</div>
        <h1>Playwright Test Builder</h1>
        <p class="tag">Visually scaffold and record C# Playwright + NUnit projects.</p>
      </div>

      <div class="cards">
        <button class="card" (click)="newProject.emit()">
          <mat-icon>add_circle_outline</mat-icon>
          <h2>New Project</h2>
          <p>Scaffold a brand new Visual Studio solution from scratch.</p>
        </button>

        <button class="card" (click)="loadProject.emit()">
          <mat-icon>folder_open</mat-icon>
          <h2>Existing Project</h2>
          <p>Browse and load an existing <span class="mono">.sln</span> file from disk.</p>
        </button>
      </div>

      <div class="footer">.NET 9 &middot; Angular 18 &middot; Microsoft.Playwright</div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .splash {
      height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 48px;
      background: radial-gradient(1200px 800px at 50% -100px, var(--primary) 0%, var(--bg-0) 60%);
    }
    .brand { text-align: center; }
    .logo { font-size: 48px; color: var(--accent); margin-bottom: 8px; }
    h1 { margin: 0; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
    .tag { color: var(--text-dim); margin-top: 8px; font-size: 15px; }
    .cards { display: flex; gap: 24px; }
    .card {
      width: 280px; padding: 28px; text-align: left; cursor: pointer;
      background: var(--bg-1); color: var(--text);
      border: 1px solid var(--border); border-radius: 12px;
      transition: all 0.18s ease; font-family: inherit;
    }
    .card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.35); }
    .card mat-icon { font-size: 36px; width: 36px; height: 36px; color: var(--accent); margin-bottom: 12px; }
    .card h2 { margin: 0 0 6px 0; font-size: 18px; font-weight: 600; }
    .card p { margin: 0; color: var(--text-dim); font-size: 13px; line-height: 1.5; }
    .mono { font-family: 'JetBrains Mono', monospace; color: var(--accent-2); }
    .footer { color: var(--text-dim); font-size: 12px; }
  `]
})
export class ProjectSelectionComponent {
  @Output() newProject = new EventEmitter<void>();
  @Output() loadProject = new EventEmitter<void>();
}
