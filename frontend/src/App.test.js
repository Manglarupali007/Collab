import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the Nexus authentication screen', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /one-to-one conversations, in real time/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
});
