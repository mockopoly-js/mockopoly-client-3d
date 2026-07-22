import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from './ConnectionStatus';

describe('ConnectionStatus', () => {
  it('shows connecting when not connected', () => {
    render(<ConnectionStatus connected={false} playerId={null} />);
    expect(screen.getByText(/connecting/i)).toBeTruthy();
  });
  it('shows connected and the player id when connected', () => {
    render(<ConnectionStatus connected={true} playerId="abc123" />);
    expect(screen.getByText(/connected/i)).toBeTruthy();
    expect(screen.getByText(/abc123/)).toBeTruthy();
  });
});
