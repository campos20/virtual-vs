import { report, yieldToUi } from './progress';

describe('yieldToUi', () => {
  // If this ever became rAF-based it could hang whenever the thread is
  // blocked or the app is backgrounded - exactly when it matters most.
  it('resolves without needing an animation frame', async () => {
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0);

    await expect(yieldToUi()).resolves.toBeUndefined();

    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('lets a pending state update run before it resolves', async () => {
    const ran: string[] = [];
    setTimeout(() => ran.push('queued work'), 0);

    await yieldToUi();

    expect(ran).toEqual(['queued work']);
  });
});

describe('report', () => {
  it('reports the phase before yielding, so the label paints first', async () => {
    const order: string[] = [];
    const onProgress = jest.fn(() => order.push('reported'));
    setTimeout(() => order.push('after yield'), 0);

    await report(onProgress, { phase: 'decoding' });

    expect(onProgress).toHaveBeenCalledWith({ phase: 'decoding' });
    // Reporting must happen first, and the yield must actually let the queue
    // drain - otherwise the message only appears once the slow work is done.
    expect(order).toEqual(['reported', 'after yield']);
  });

  it('does nothing and stays cheap without a reporter', async () => {
    await expect(report(undefined, { phase: 'building' })).resolves.toBeUndefined();
  });
});
