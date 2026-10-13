import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('web-next App', () => {
  it('renders the stub', () => {
    render(<App />);
    expect(screen.getByText('SMS (next)')).toBeTruthy();
  });
});
