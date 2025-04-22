const express = require('express');
const laudoController = require('../controllers/laudoController');
const authMiddleware = require('../middleware/authMiddleware');
const autorizacaoMiddleware = require('../middleware/autorizacaoMiddleware');
const upload = require('../utils/multerConfig');
const { auditLog } = require('../middleware/auditMiddleware');

const router = express.Router();

// Rascunhos de Laudo
router.post(
  '/',
  authMiddleware,
  autorizacaoMiddleware(['medico']),
  auditLog('create', 'Tentativa de criação de laudo'),
  laudoController.criarLaudo
);

// Refazer Laudo
router.post(
  '/:id/refazer',
  authMiddleware,
  autorizacaoMiddleware(['medico']),
  auditLog('recreate', 'Tentativa de refazer laudo'),
  laudoController.refazerLaudo
);

// Histórico de Versões
router.get(
  '/:id/historico',
  authMiddleware,
  laudoController.getHistoricoLaudo
);

// Listar Laudos
router.get(
  '/',
  authMiddleware,
  laudoController.listarLaudos
);

router.get(
  '/pacientes/:id',
  authMiddleware,
  laudoController.listarLaudosPorPaciente
);

// Obter Laudo por ID
router.get(
  '/:id',
  authMiddleware,
  laudoController.obterLaudo
);

// Geração de PDF
router.get(
  '/:id/pdf',
  authMiddleware,
  laudoController.gerarPdfLaudo
);

// Upload de Laudo Assinado
router.post(
  '/:id/upload',
  authMiddleware,
  autorizacaoMiddleware(['medico', 'admin']),
  auditLog('upload_signed', 'Tentativa de upload de laudo assinado'),
  upload.single('signedFile'),
  laudoController.uploadSignedLaudo
);

// Download de Laudos
router.get(
    '/:id/download/original',
    authMiddleware,
    laudoController.downloadLaudoOriginal
  );
  
  router.get(
    '/:id/download/assinado',
    authMiddleware,
    laudoController.downloadLaudoAssinado
  );

// Estatísticas e Relatórios
router.get(
  '/estatisticas',
  authMiddleware,
  laudoController.getEstatisticas
);

router.get(
  '/relatorio-status',
  authMiddleware,
  laudoController.getLaudosPorStatus
);

// Laudos por Exame
router.get(
  '/exame/:id',
  authMiddleware,
  laudoController.getLaudosPorExame
);

// Adicione esta rota
router.post('/:id/enviar-email', authMiddleware, laudoController.enviarEmailLaudo);

router.get('/laudos/:path(*)/download', (req, res) => {
    const filePath = path.join(__dirname, '../..', req.params.path);
    res.sendFile(filePath);
  });

router.get('/publico/:id', laudoController.visualizarLaudoPublico);
router.post('/publico/:id/auth', laudoController.autenticarLaudoPublico);

router.patch('/laudos/:id/invalidar', authMiddleware, laudoController.invalidarLaudo);

router.get('/reports/laudos', authMiddleware, laudoController.gerarRelatorio);

router.get('/relatorios/exportar-pdf', authMiddleware, laudoController.relatorioPdf);

module.exports = router;