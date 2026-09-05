import { Request, Response } from 'express';
import { Container } from 'typedi';

import { CityTimeService } from '../services';

/*
 * Compatibility surface for the historical VRML worlds. Endpoints here are
 * named after what they do, never after the dead host they replace, and they
 * return only the data the legacy content actually reads.
 */
class CompatController {

  constructor(
    private cityTimeService: CityTimeService,
  ) { }

  // JSON view, for the SPA and for tests.
  async getCityTime(request: Request, response: Response) {
    return response
      .set('Cache-Control', 'no-store')
      .json(this.cityTimeService.getCityTime());
  }

  // VRML view, fetched by Browser.createVrmlFromURL() inside the worlds.
  async getCityTimeVrml(request: Request, response: Response) {
    const time = this.cityTimeService.getCityTime();
    return response
      .set('Content-Type', 'model/vrml')
      .set('Cache-Control', 'no-store')
      .send(this.cityTimeService.toVrml(time));
  }
}

export const compatController = new CompatController(
  Container.get(CityTimeService),
);
