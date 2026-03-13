import { Component, Input, Output, EventEmitter } from '@angular/core';
import { UserService } from './user.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="user">
      <h1>{{ user.name }}</h1>
      <p>Age: {{ user.age }}</p>
    </div>
    <div *ngIf="!user">
      <p>Loading...</p>
    </div>
    <ul>
      <li *ngFor="let skill of user?.skills">{{ skill }}</li>
    </ul>
    <button (click)="onSave()">Save</button>
  `
})
export class UserProfileComponent {
  @Input() userId!: string;
  @Input() showDetails = false;
  @Output() saved = new EventEmitter<void>();

  user: any;

  constructor(private userService: UserService) {}

  ngOnInit() {
    this.user = this.userService.getUser(this.userId);
  }

  onSave() {
    this.userService.saveUser(this.user);
    this.saved.emit();
  }
}
