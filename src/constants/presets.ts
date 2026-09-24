export type PresetProvenance = 'verified' | 'unverified';

export interface PatternPreset {
    id: string;
    name: string;
    file: string;
    type: 'svg' | 'dxf' | 'stl';
    category: 'patterns' | 'inlays' | 'outlines';
    keepOriginalColors?: boolean;
    infoUrl?: string;
    credit?: string;
    license?: string;
    provenance?: PresetProvenance;
}

export const PRESETS: PatternPreset[] = [
    // Patterns
    { id: 'pattern/pyramid', name: 'Pyramid', file: 'pyramid.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/grippysheet-v1', name: 'GrippySheet V1', file: 'grippysheet-v1.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/dome', name: 'Dome', file: 'dome.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/stud', name: 'Stud', file: 'stud.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/tryramid', name: 'Tryramid', file: 'tryramid.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/hexyramid', name: 'Hexyramid', file: 'hexyramid.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/bevelled-cube', name: 'Bevelled Cube', file: 'bevelled-cube.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/pyramid-skewed', name: 'Skewed Pyramid', file: 'pyramid-skewed.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/nipple', name: 'Nipple', file: 'nipple.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/pubgrip', name: 'PubGrip', file: 'pubgrip.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/thane-classic', name: 'Thane Classic', file: 'thane-classic.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/mitsi', name: 'Mitsi', file: 'mitsi.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/polypore-single', name: 'Polypore Single', file: 'polypore-single.stl', type: 'stl', category: 'patterns' },
    { id: 'pattern/polypore-flower', name: 'Polypore Flower', file: 'polypore-flower.stl', type: 'stl', category: 'patterns' },
    
    // Inlays
    { id: 'inlay/grippysheet', name: 'GrippySheet', file: 'grippysheet.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/grippysheetalt', name: 'GrippySheet Alt', file: 'grippysheetalt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/grippysheetdrip', name: 'GrippySheet Drip', file: 'grippysheetdrip.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/grippysheetbadge', name: 'GrippySheet Badge', file: 'grippysheetbadge.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/grippysheetbadgealt', name: 'GrippySheet Alt Badge', file: 'grippysheetbadgealt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/pubmote', name: 'Pubmote', file: 'pubmote.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/floatwheel', name: 'Floatwheel', file: 'floatwheel.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/trogdor', name: 'Trogdor the Burninator', file: 'trogdor.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/spooderman', name: 'Spooderman', file: 'spooderman.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/dolan', name: 'Dolan Duck', file: 'dolan.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/gooby', name: 'Gooby', file: 'gooby.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { id: 'inlay/matixbuilt', name: 'MatixBuilt', file: 'matixbuilt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },

    // Outlines
    { id: 'outline/xrstock', name: 'XR Stock', file: 'xrstock.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/xrcobraviper', name: 'XR Cobra/Viper', file: 'xrcobraviper.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/xrkushwide', name: 'XR Kush Wide', file: 'xrkushwide.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/xrmushiesv2', name: 'XR Mushies V2', file: 'xrmushiesv2.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/xrpubpad', name: 'XR PubPad', file: 'xrpubpad.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/xrstompies', name: 'XR Stompies', file: 'xrstompies.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/xrviperbitewide', name: 'XR Viperbite Wide', file: 'xrviperbitewide.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/floatwheeladv', name: 'Floatwheel ADV', file: 'floatwheeladv.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/floatwheelatom', name: 'Floatwheel Atom', file: 'floatwheelatom.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/gtstock', name: 'GT Stock', file: 'gtstock.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/gtkushwide', name: 'GT Kush Wide', file: 'gtkushwide.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/gtmushies', name: 'GT Mushies', file: 'gtmushies.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/gtfst', name: 'GT FST', file: 'gtfst.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/gtlowboyflared', name: 'GT Lowboy Flared', file: 'gtlowboyflared.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/pint', name: 'Pint', file: 'pint.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified', infoUrl: 'https://www.printables.com/model/968803' },
    { id: 'outline/pintmatix', name: 'Pint Matix', file: 'pintmatix.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' },
    { id: 'outline/gosmilox7', name: 'Gosmilo X7', file: 'gosmilox7.dxf', type: 'dxf', category: 'outlines', provenance: 'unverified' }
];
