Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
Object.defineProperty(window, "matchMedia", { writable: true, value: () => ({ matches: false, media: "", onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} }) });
