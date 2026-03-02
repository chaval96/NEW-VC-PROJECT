import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { body, validationResult } from 'express-validator';

describe('Workspace Validation', () => {
  let app: express.Application;
  
  const handleValidationErrors: express.RequestHandler = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    next();
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mock workspace creation endpoint with validation
    app.post(
      '/api/workspaces',
      [
        body('name').notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name must be 100 characters or less')
      ],
      handleValidationErrors,
      (req, res) => {
        res.status(201).json({ 
          id: 'workspace-123',
          name: req.body.name,
          createdAt: new Date().toISOString()
        });
      }
    );

    // Mock workspace profile update endpoint
    app.patch(
      '/api/workspaces/:id/profile',
      [
        body('company').optional().isLength({ max: 200 }).withMessage('Company name too long'),
        body('website').optional().isURL().withMessage('Invalid website URL'),
        body('senderEmail').optional().isEmail().withMessage('Invalid email format')
      ],
      handleValidationErrors,
      (req, res) => {
        res.json({ 
          id: req.params.id,
          profile: req.body,
          updatedAt: new Date().toISOString()
        });
      }
    );
  });

  describe('Workspace Creation Validation', () => {
    it('should accept valid workspace creation request', async () => {
      const response = await request(app)
        .post('/api/workspaces')
        .send({ name: 'Test Workspace' });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', 'Test Workspace');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should reject workspace creation with empty name', async () => {
      const response = await request(app)
        .post('/api/workspaces')
        .send({ name: '' });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'Name is required'
          })
        ])
      );
    });

    it('should reject workspace creation with name too long', async () => {
      const longName = 'a'.repeat(101);
      const response = await request(app)
        .post('/api/workspaces')
        .send({ name: longName });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'Name must be 100 characters or less'
          })
        ])
      );
    });

    it('should reject workspace creation with missing name field', async () => {
      const response = await request(app)
        .post('/api/workspaces')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('Workspace Profile Validation', () => {
    it('should accept valid profile update', async () => {
      const response = await request(app)
        .patch('/api/workspaces/workspace-123/profile')
        .send({ 
          company: 'Test Company',
          website: 'https://example.com',
          senderEmail: 'test@example.com'
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'workspace-123');
      expect(response.body).toHaveProperty('profile');
      expect(response.body).toHaveProperty('updatedAt');
    });

    it('should reject invalid website URL', async () => {
      const response = await request(app)
        .patch('/api/workspaces/workspace-123/profile')
        .send({ website: 'not-a-url' });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'Invalid website URL'
          })
        ])
      );
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .patch('/api/workspaces/workspace-123/profile')
        .send({ senderEmail: 'invalid-email' });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'Invalid email format'
          })
        ])
      );
    });

    it('should accept partial profile updates', async () => {
      const response = await request(app)
        .patch('/api/workspaces/workspace-123/profile')
        .send({ company: 'Updated Company' });
      
      expect(response.status).toBe(200);
      expect(response.body.profile).toHaveProperty('company', 'Updated Company');
    });

    it('should handle empty profile update request', async () => {
      const response = await request(app)
        .patch('/api/workspaces/workspace-123/profile')
        .send({});
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'workspace-123');
    });
  });

  describe('Input Sanitization', () => {
    it('should handle special characters in workspace name', async () => {
      const response = await request(app)
        .post('/api/workspaces')
        .send({ name: 'Test & Company <script>' });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('name', 'Test & Company <script>');
    });

    it('should handle unicode characters in workspace name', async () => {
      const response = await request(app)
        .post('/api/workspaces')
        .send({ name: 'Test 测试 Workspace' });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('name', 'Test 测试 Workspace');
    });
  });
});
