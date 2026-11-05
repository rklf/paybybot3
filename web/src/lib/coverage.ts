/** Asking to change the vehicles the subscription covers: the window (CoverageHost, mounted once) shows what it
 *  costs and makes the change once confirmed. Kept apart from the window so the API client can ask too. */
export type CoverageRequest = { plates: string[]; resolve: (done: boolean) => void }

let show: ((r: CoverageRequest) => void) | null = null

export function listenCoverage(f: ((r: CoverageRequest) => void) | null) {
  show = f
}

/** plates: every vehicle to be covered afterwards. True once the change is made (paid if it had to be). */
export function askCoverage(plates: string[]): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ plates, resolve }) : resolve(false)))
}
