import { Composition, Still } from 'remotion'
import { TOTAL_FRAMES, FPS } from './edit'
import { Loop, LOOP_FRAMES, Tour } from './Tour'
import { Og } from './Og'

export function Root() {
  return (
    <>
      <Composition
        id="Tour"
        component={Tour}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Loop"
        component={Loop}
        durationInFrames={LOOP_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Still id="Og" component={Og} width={1200} height={630} />
    </>
  )
}
