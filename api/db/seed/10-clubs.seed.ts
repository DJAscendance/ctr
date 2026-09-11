import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  console.log('Seeding Club Directory Place data');
  
  await knex('place').insert({
    assets_dir: null,
    description: 'Welcome to Clubs Directory',
    name: 'Clubs Directory',
    slug: 'clubdir',
    status: 1,
    world_filename: null,
    type: 'public',
    map_background_index: null,
    map_icon_index: null,
    member_id: null,
    messageboard_intro: null,
    inbox_intro: null,
    private: 0,
  });
  
  await knex('place').insert({
    /* Both halves were wrong here: no leading slash, and the `vrml/` segment on
     * the wrong side of the split. Concatenated they gave 'club/vrml/vrml.wrl',
     * which the client resolves relative to the current route instead of the
     * asset root. The deployed row is '/club/' + 'vrml/vrml.wrl'. */
    assets_dir: '/club/',
    description: 'Welcome to Newcomers Club',
    name: 'Newcomers Club',
    slug: 'newcomers',
    status: 1,
    world_filename: 'vrml/vrml.wrl',
    type: 'public',
    map_background_index: null,
    map_icon_index: null,
    member_id: null,
    messageboard_intro: null,
    inbox_intro: null,
    private: 0,
  });
}
