import Router from 'express';

import { homeController } from '../controllers';

/**
 * This file sets up routing for home routes.
 * @note All paths used here will be prepended with `/api/home`.
 */

const homeRoutes = Router();
homeRoutes.get('',
  (request, response) => homeController.getHome(request, response));
homeRoutes.get('/:username',
  (request, response) => homeController.getHome(request, response));
homeRoutes.post('/settle',
  (request, response) => homeController.createHome(request, response));
homeRoutes.post('/move',
  (request, response) => homeController.moveHome(request, response));
homeRoutes.post('/update',
  (request, response) => homeController.updateHome(request, response));
homeRoutes.post('/upload-image',
  (request, response) => homeController.uploadImage(request, response));
homeRoutes.post('/remove-image',
  (request, response) => homeController.removeImage(request, response));
export { homeRoutes };
