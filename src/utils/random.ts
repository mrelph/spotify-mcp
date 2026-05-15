import {randomBytes} from 'node:crypto'

/**
 * Generates a cryptographically secure random hex string for OAuth state parameters.
 * @param length Number of random bytes (hex output will be 2x this length)
 */
export function generateRandomString(length: number): string {
  return randomBytes(length).toString('hex')
}
