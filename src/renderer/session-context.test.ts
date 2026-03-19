import {
  setContextData,
  getContext,
  onChange,
  removeSession,
  _resetForTesting,
} from './session-context';

beforeEach(() => {
  _resetForTesting();
});

describe('setContextData', () => {
  it('computes usedPercentage correctly', () => {
    setContextData('s1', {
      total_input_tokens: 80_000,
      total_output_tokens: 20_000,
      context_window_tokens: 200_000,
    });

    const ctx = getContext('s1');
    expect(ctx).toEqual({
      totalTokens: 100_000,
      contextWindowSize: 200_000,
      usedPercentage: 50,
    });
  });

  it('uses default context window when not specified', () => {
    setContextData('s1', {
      total_input_tokens: 100_000,
      total_output_tokens: 0,
    });

    const ctx = getContext('s1');
    expect(ctx!.contextWindowSize).toBe(200_000);
    expect(ctx!.usedPercentage).toBe(50);
  });

  it('defaults missing token counts to 0', () => {
    setContextData('s1', {});
    const ctx = getContext('s1');
    expect(ctx!.totalTokens).toBe(0);
    expect(ctx!.usedPercentage).toBe(0);
  });

  it('handles zero context window size without division by zero', () => {
    setContextData('s1', {
      total_input_tokens: 100,
      total_output_tokens: 50,
      context_window_tokens: 0,
    });
    expect(getContext('s1')!.usedPercentage).toBe(0);
  });

  it('notifies listeners', () => {
    const cb = vi.fn();
    onChange(cb);
    setContextData('s1', { total_input_tokens: 100 });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining({ totalTokens: 100 }));
  });
});

describe('getContext', () => {
  it('returns null for unknown session', () => {
    expect(getContext('unknown')).toBeNull();
  });
});

describe('removeSession', () => {
  it('removes session from map', () => {
    setContextData('s1', { total_input_tokens: 100 });
    removeSession('s1');
    expect(getContext('s1')).toBeNull();
  });
});
