import { Composition } from 'remotion'
import { FPS, Landing, TOTAL } from './Landing'

/** The home page loop: 16:9 on computers, 4:5 on phones (the size of its frame on the page). */
export function Root() {
  return (
    <>
      <Composition id="Landing" component={Landing} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
      <Composition id="LandingMobile" component={Landing} durationInFrames={TOTAL} fps={FPS} width={1080} height={1350} />
    </>
  )
}
