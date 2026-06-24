import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'getting-started',
    'creation-paths',
    {
      type: 'category',
      label: 'Tutorials',
      collapsed: false,
      items: [
        'tutorials/typescript-game',
        'tutorials/text-maps',
        'tutorials/visual-editor',
        'tutorials/studio-3d',
        'tutorials/gamedoc-editor',
        'tutorials/scripting',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture/overview',
        'architecture/engine',
        'architecture/wiring',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      collapsed: false,
      items: [
        'deployment/native-clients',
        'deployment/server-architecture',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: true,
      items: [
        'reference/sdk',
        'reference/weapons',
        'reference/gamedoc-spec',
      ],
    },
  ],
};

export default sidebars;
