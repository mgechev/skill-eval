---
name: angular-modern-apis
description: Guidelines for using modern Angular APIs (signals, inject, control flow)
---

# Angular Modern APIs

This skill describes the mandatory coding standards for Angular components in our codebase.

## Rules

All Angular components must follow these rules:

1. **Use signal-based inputs** — Use `input()` and `output()` instead of `@Input()` and `@Output()` decorators
2. **Use `inject()` for DI** — Use `inject()` function instead of constructor parameter injection
3. **Use built-in control flow** — Use `@if`, `@for`, `@switch` instead of `*ngIf`, `*ngFor`, `*ngSwitch`

## Examples

### Signal inputs (correct)

```typescript
import { Component, input, output } from '@angular/core';

@Component({ ... })
export class UserProfileComponent {
  name = input.required<string>();
  age = input(0);
  saved = output<void>();
}
```

### inject() for DI (correct)

```typescript
import { Component, inject } from '@angular/core';
import { UserService } from './user.service';

@Component({ ... })
export class UserProfileComponent {
  private userService = inject(UserService);
}
```

### Built-in control flow (correct)

```html
@if (user()) {
  <h1>{{ user().name }}</h1>
} @else {
  <p>No user found</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.name }}</li>
}
```
