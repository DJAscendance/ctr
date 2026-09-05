import Router from 'express';

import { compatController } from '../controllers';

const compatRoutes = Router();
compatRoutes.get('/city-time', (request, response) =>
  compatController.getCityTime(request, response));
compatRoutes.get('/city-time.wrl', (request, response) =>
  compatController.getCityTimeVrml(request, response));

export { compatRoutes };
