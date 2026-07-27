import Router from 'express';

import { homeController } from '../controllers';

/**
 * This file sets up routing for home routes.
 * @note All paths used here will be prepended with `/api/home`.
 */

const homeRoutes = Router();
homeRoutes.get('',
  (request, response) => homeController.getHome(request, response));
homeRoutes.get('/moderation/queue',
  (request, response) => homeController.getImageModerationQueue(request, response));
homeRoutes.get('/moderation/:placeId/image',
  (request, response, next) => homeController.previewImage(request, response, next));
homeRoutes.post('/moderation/:placeId/approve',
  (request, response) => homeController.approveImage(request, response));
homeRoutes.post('/moderation/:placeId/reject',
  (request, response) => homeController.rejectImage(request, response));
// Must stay above the '/:username' catch-all below, which would otherwise match
// 'information' as a username.
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
// POST-only: reset is destructive, so it must never be reachable by a GET or a navigation.
homeRoutes.post('/reset',
  (request, response) => homeController.resetHome(request, response));
homeRoutes.post('/upload-image',
  (request, response) => homeController.uploadImage(request, response));
homeRoutes.post('/remove-image',
  (request, response) => homeController.removeImage(request, response));
export { homeRoutes };
