import Router from 'express';

import { homeController } from '../controllers';

/**
 * This file sets up routing for home routes.
 * @note All paths used here will be prepended with `/api/home`.
 */

const homeRoutes = Router();
homeRoutes.get('',
  (request, response) => homeController.getHome(request, response));
homeRoutes.get('/chat-access',
  (request, response) => homeController.getChatAccess(request, response));
homeRoutes.post('/chat-access',
  (request, response) => homeController.updateChatAccess(request, response));
homeRoutes.get('/chat-access/status/:placeId',
  (request, response) => homeController.getChatAccessStatus(request, response));
homeRoutes.get('/information/:placeId',
  (request, response) => homeController.getHomeInformation(request, response));
homeRoutes.get('/:username',
  (request, response) => homeController.getHome(request, response));
homeRoutes.post('/settle',
  (request, response) => homeController.createHome(request, response));
homeRoutes.post('/move',
  (request, response) => homeController.moveHome(request, response));
homeRoutes.post('/update',
  (request, response) => homeController.updateHome(request, response));
homeRoutes.post('/update-information',
  (request, response) => homeController.updateHomeInformation(request, response));
homeRoutes.post('/upload-image',
  (request, response) => homeController.uploadImage(request, response));
homeRoutes.post('/remove-image',
  (request, response) => homeController.removeImage(request, response));
homeRoutes.post('/reset',
  (request, response) => homeController.resetHome(request, response));
export { homeRoutes };
