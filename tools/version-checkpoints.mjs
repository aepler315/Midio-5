// Authored visual order, independent of the rollback order of main.
// Profiles come from pinned main/HTML/HUD source inspection, not PR ranges.
// Hashes describe original pinned files; staging records emitted hashes separately.
export const LIVE_ID = 'natural-valley';
export const MAX_SITE_BYTES = 838860800;
export const PUBLIC_PATHS = Object.freeze(['index.html', 'src', 'soundfonts']);

export const CHECKPOINTS = Object.freeze([
  Object.freeze({
    id: 'glacial-flight', label: 'Glacial valley', sourcePr: 338,
    sourceSha: 'bbe0afcae722c59c774b5c7396b55cfa4342c616', compatibilityProfile: 'glacial-range',
    publicBytes: 37002621,
    sourceHashes: Object.freeze({
      'src/main.js': 'ce2697aff6f5990f517db3cf8768701517421f2ff5f1629dccf56475b01def70',
      'index.html': '444214f1c31f8e6e121bc0df5a28d92c25551b81584f1ad22e3fd52f2f59ef77',
      'src/ui/style.css': 'a491c07b3e311e5c8c4f78f48d6125818939c284a190951dde1818143e7658c5',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'range-before-journey', label: 'Original Range', sourcePr: 391,
    sourceSha: '7383b3b34c4f5e1f3cf062fb6078178aaa24a0b6', compatibilityProfile: 'original-range',
    publicBytes: 101114208,
    sourceHashes: Object.freeze({
      'src/main.js': '1178c6ff3545e9522bce4d5ca81132ec232f1c5d88b6de7a2865c45f011bd3e8',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'moonlit-cove', label: 'Moonlit cove', sourcePr: 396,
    sourceSha: '70c9cb8f8fa1aae40a51060b1d2f132af9ee5ca4', compatibilityProfile: 'moonlit-cove',
    publicBytes: 101179835,
    sourceHashes: Object.freeze({
      'src/main.js': '11f0eeec93d3db3393ac7e02f61380c9221c6bf50de94115da18815949631c2d',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'traveling-valley', label: 'Traveling valley', sourcePr: 397,
    sourceSha: '316e50ea1db66c185d194f511a8a1cc62bb7a936', compatibilityProfile: 'journey-valley',
    publicBytes: 101231430,
    sourceHashes: Object.freeze({
      'src/main.js': '95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'detailed-valley', label: 'Detailed valley', sourcePr: 398,
    sourceSha: 'be8d0c4c0bd33e3839ba2a8b6f154a9e38e0ebef', compatibilityProfile: 'journey-valley',
    publicBytes: 101249710,
    sourceHashes: Object.freeze({
      'src/main.js': '95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'natural-valley', label: 'Mountain valley', sourcePr: 399,
    sourceSha: '7557f85bae8e4f7d61f5fd9d8d628d52c052565c', compatibilityProfile: 'journey-valley',
    publicBytes: 101273423,
    sourceHashes: Object.freeze({
      'src/main.js': '95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'circular-world', label: 'Circular world', sourcePr: 400,
    sourceSha: '4c61f72d4cb782822fcabf5d2b1c8e785cc13e16', compatibilityProfile: 'journey-valley',
    publicBytes: 101298862,
    sourceHashes: Object.freeze({
      'src/main.js': '95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
  Object.freeze({
    id: 'spherical-world', label: 'Curved landscape', sourcePr: 402,
    sourceSha: 'a901332676557d33536d2cbbd1e1a4da9de4a4ca', compatibilityProfile: 'journey-valley',
    publicBytes: 101302422,
    sourceHashes: Object.freeze({
      'src/main.js': '95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9',
      'index.html': '08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874',
      'src/ui/style.css': 'cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14',
      'src/audio/AnalysisCache.js': '147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed',
    }),
  }),
]);
