import { devToolsEnabled } from './env';

/**
 * The dev fill simulator is a write endpoint. Whether it exists in a given process is a
 * security control, so the rule that decides it gets a test rather than a comment.
 */
describe('devToolsEnabled', () => {
  it('is on only in a non-production environment with the flag explicitly set', () => {
    expect(devToolsEnabled({ nodeEnv: 'development', devTools: 'on' })).toBe(true);
  });

  it('is off in production even when the flag is on', () => {
    // Belt and braces: someone shipping a container with DEV_TOOLS=on inherited from a
    // staging config should not get a write endpoint mounted in production.
    expect(devToolsEnabled({ nodeEnv: 'production', devTools: 'on' })).toBe(false);
  });

  it('is off when the flag is missing, not just when it says off', () => {
    // The failure this guards: a single NODE_ENV check would mount the endpoint in any
    // environment where NODE_ENV is unset or misspelt, which is most of the ones nobody
    // configured on purpose.
    expect(devToolsEnabled({ nodeEnv: 'development', devTools: '' })).toBe(false);
    expect(devToolsEnabled({ nodeEnv: '', devTools: '' })).toBe(false);
    expect(devToolsEnabled({ nodeEnv: 'staging', devTools: 'true' })).toBe(false);
    expect(devToolsEnabled({ nodeEnv: 'staging', devTools: 'ON' })).toBe(false);
  });
});
