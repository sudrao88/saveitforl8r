import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RecipeCalculatorDialog from './RecipeCalculatorDialog';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
});

const sampleIngredients = [
  '2 cups flour',
  '1 tsp salt',
  '3 eggs',
  'Salt to taste',
];

function renderOpen(ingredients = sampleIngredients) {
  const onClose = vi.fn();
  const utils = render(
    <RecipeCalculatorDialog ingredients={ingredients} isOpen={true} onClose={onClose} />,
  );
  return { onClose, ...utils };
}

describe('RecipeCalculatorDialog', () => {
  it('renders one editable row per parseable ingredient', () => {
    renderOpen();
    const rows = screen.getAllByTestId('ingredient-row');
    expect(rows).toHaveLength(3); // flour, salt, eggs
  });

  it('renders unparseable rows greyed-out without an input', () => {
    renderOpen();
    const unparseable = screen.getByTestId('ingredient-row-unparseable');
    expect(unparseable).toHaveTextContent('Salt to taste');
    expect(within(unparseable).queryByRole('textbox')).toBeNull();
  });

  it('rescales every row when one quantity is edited', () => {
    renderOpen();
    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    const saltInput = screen.getByLabelText(/Quantity for salt/i) as HTMLInputElement;
    const eggsInput = screen.getByLabelText(/Quantity for eggs/i) as HTMLInputElement;

    expect(flourInput.value).toBe('2');
    expect(saltInput.value).toBe('1');
    expect(eggsInput.value).toBe('3');

    // Double the recipe by changing flour 2 -> 4 cups (scale 2x)
    fireEvent.change(flourInput, { target: { value: '4' } });
    fireEvent.blur(flourInput);

    expect(flourInput.value).toBe('4');
    expect(saltInput.value).toBe('2');
    expect(eggsInput.value).toBe('6');
  });

  it('snaps fractional results to common cooking fractions', () => {
    renderOpen();
    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    const saltInput = screen.getByLabelText(/Quantity for salt/i) as HTMLInputElement;

    // Halve: 2 cups -> 1 cup, 1 tsp -> 1/2 tsp
    fireEvent.change(flourInput, { target: { value: '1' } });
    fireEvent.blur(flourInput);
    expect(saltInput.value).toBe('1/2');
  });

  it('reverts invalid edits without changing the scale', () => {
    renderOpen();
    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    const saltInput = screen.getByLabelText(/Quantity for salt/i) as HTMLInputElement;

    fireEvent.change(flourInput, { target: { value: 'abc' } });
    fireEvent.blur(flourInput);

    expect(saltInput.value).toBe('1');
    expect(flourInput.value).toBe('2'); // reverted
  });

  it('rejects zero / negative input (no divide-by-zero scale change)', () => {
    renderOpen();
    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    const saltInput = screen.getByLabelText(/Quantity for salt/i) as HTMLInputElement;

    fireEvent.change(flourInput, { target: { value: '0' } });
    fireEvent.blur(flourInput);
    expect(saltInput.value).toBe('1');
    expect(flourInput.value).toBe('2');
  });

  it('switches all volumes to ml when Metric is selected', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Metric' }));

    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    expect(flourInput.value).toBe('473.18'); // 2 cups -> ~473.18 ml
    expect(screen.getAllByText('ml').length).toBeGreaterThan(0);
  });

  it('Reset returns scale to 1 and clears drafts', () => {
    renderOpen();
    const flourInput = screen.getByLabelText(/Quantity for flour/i) as HTMLInputElement;
    const saltInput = screen.getByLabelText(/Quantity for salt/i) as HTMLInputElement;

    fireEvent.change(flourInput, { target: { value: '4' } });
    fireEvent.blur(flourInput);
    expect(saltInput.value).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /Reset/i }));
    expect(flourInput.value).toBe('2');
    expect(saltInput.value).toBe('1');
  });

  it('calls onClose when the X button is clicked', () => {
    const { onClose } = renderOpen();
    fireEvent.click(screen.getByLabelText(/Close calculator/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape, and stops the event from reaching parent listeners', () => {
    // Mirror MemoryPreviewModal's listener: bubble-phase, attached on window.
    const parentHandler = vi.fn();
    window.addEventListener('keydown', parentHandler);
    const { onClose } = renderOpen();
    parentHandler.mockClear();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentHandler).not.toHaveBeenCalled();

    window.removeEventListener('keydown', parentHandler);
  });

  it('renders into document.body via portal', () => {
    renderOpen();
    const dialog = screen.getByTestId('recipe-calculator-dialog');
    expect(dialog.parentElement).toBe(document.body);
  });

  it('handles empty ingredients gracefully', () => {
    renderOpen([]);
    expect(screen.getByText(/No ingredients to scale/i)).toBeInTheDocument();
  });

  it('handles all-unparseable ingredients', () => {
    renderOpen(['Salt to taste', 'A pinch of pepper']);
    expect(screen.queryAllByTestId('ingredient-row')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingredient-row-unparseable')).toHaveLength(2);
    expect(screen.getByText(/None of these ingredients have a numeric quantity/i)).toBeInTheDocument();
  });
});
