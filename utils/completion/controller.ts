import { reduceCompletionState } from './reducer'
import type {
  CompletionEffect,
  CompletionEvent,
  CompletionState,
} from './state'

export class CompletionController {
  private state: CompletionState
  private readonly onEffects: (effects: CompletionEffect[], state: CompletionState) => void

  constructor(args: {
    initialState?: CompletionState
    onEffects: (effects: CompletionEffect[], state: CompletionState) => void
  }) {
    this.state = args.initialState ?? {
      composeActive: false,
      mode: 'idle',
      snapshot: null,
      session: null,
    }
    this.onEffects = args.onEffects
  }

  getState(): CompletionState {
    return this.state
  }

  dispatch(event: CompletionEvent) {
    const transition = reduceCompletionState(this.state, event)
    this.state = transition.state
    if (transition.effects.length > 0) {
      this.onEffects(transition.effects, this.state)
    }
  }
}
