import { MemorySpaceStore } from '../src/index.js'
import { storeSuite } from './store-suite.js'

storeSuite('memory', { make: async (claims) => new MemorySpaceStore({ claims }) })
