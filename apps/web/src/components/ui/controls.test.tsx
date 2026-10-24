import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button, IconButton } from './Button';
import { SelectField, Switch, TextField } from './fields';
import { CloseIcon } from './icons';
import { SegmentedControl, Tabs } from './Tabs';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('calls onClick and can be keyboard activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('loading disables the button, sets aria-busy and keeps the label', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no accessibility violations in any variant', async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Loading</Button>
        <IconButton label="Close">
          <CloseIcon />
        </IconButton>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('IconButton', () => {
  it('is named by its label, not by the decorative icon', () => {
    render(
      <IconButton label="Close menu">
        <CloseIcon />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
  });
});

describe('TextField', () => {
  it('connects label, hint and input', () => {
    render(<TextField label="Display name" hint="Shown to other members." />);
    const input = screen.getByLabelText('Display name');
    expect(input).toHaveAccessibleDescription('Shown to other members.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the field invalid and describes it with the error instead of the hint', () => {
    render(<TextField label="Email" hint="We never share it." error="Enter a valid email." />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email.');
  });

  it('can hide the label visually and keep it for assistive technology', () => {
    render(<TextField label="Search" hideLabel />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByText('Search')).toHaveClass('sr-only');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <form>
        <TextField label="Email" error="Enter a valid email." />
        <TextField label="Name" hint="Shown to others." />
      </form>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('SelectField', () => {
  it('is a labelled native select', async () => {
    const user = userEvent.setup();
    render(
      <SelectField label="Role" defaultValue="READ_ONLY">
        <option value="READ_ONLY">Read only</option>
        <option value="ADMIN">Admin</option>
      </SelectField>,
    );
    const select = screen.getByRole('combobox', { name: 'Role' });
    await user.selectOptions(select, 'ADMIN');
    expect(select).toHaveValue('ADMIN');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <SelectField label="Role" error="Pick a role">
        <option value="a">A</option>
      </SelectField>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Switch', () => {
  function Harness({ onChange }: { onChange?: (v: boolean) => void }) {
    const [on, setOn] = useState(false);
    return (
      <Switch
        label="Effects"
        description="Turns glow on or off"
        checked={on}
        onCheckedChange={(v) => {
          setOn(v);
          onChange?.(v);
        }}
      />
    );
  }

  it('is a switch with a state, toggled by click, Space and Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Effects' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  });

  it('exposes its description', () => {
    render(<Harness />);
    expect(screen.getByRole('switch', { name: 'Effects' })).toHaveAccessibleDescription(
      'Turns glow on or off',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});

describe('SegmentedControl', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
      <SegmentedControl
        label="Resolution"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'a', label: 'Interval' },
          { value: 'b', label: 'Hourly' },
          { value: 'c', label: 'Daily' },
        ]}
      />
    );
  }

  it('is a named radio group with one tab stop; arrow keys change the choice', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Resolution' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Interval' })).toBeChecked();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Interval' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Hourly' })).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});

describe('Tabs', () => {
  function Harness() {
    return (
      <Tabs
        label="Views"
        tabs={[
          { id: 'one', label: 'First', panel: <p>First panel</p> },
          { id: 'two', label: 'Second', panel: <p>Second panel</p> },
          { id: 'three', label: 'Third', panel: <p>Third panel</p> },
        ]}
      />
    );
  }

  it('uses tablist, tab and tabpanel roles, with the panel named by its tab', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'First' })).toHaveTextContent('First panel');
  });

  it('has one tab stop: only the selected tab is tabbable', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with Left, Right, Home and End, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Third' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'First' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Third' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'First' })).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});
