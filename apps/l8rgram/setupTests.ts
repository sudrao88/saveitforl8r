import '@testing-library/jest-dom';
// jsdom ships no IndexedDB; the encrypted L8rgramDB store and the shared crypto
// keystore both need one under test. fake-indexeddb installs a spec-compliant
// in-memory implementation on the global scope.
import 'fake-indexeddb/auto';
