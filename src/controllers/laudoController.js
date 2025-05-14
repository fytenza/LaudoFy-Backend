const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const Laudo = require('../models/Laudo');
const Exame = require('../models/Exame');
const { sendMedicalReport } = require('../services/emailService');
const logger = require('../utils/logger');
const QRCode = require('qrcode');
const AuditLog = require('../models/AuditModel');
const Usuario = require('../models/Usuario');
const { uploadPDFToUploadcare } = require('../services/uploadcareService');
const imageSize = require('image-size');

// Configurações de diretórios
const LAUDOS_DIR = path.join(__dirname, '../../laudos');
const LAUDOS_ASSINADOS_DIR = path.join(LAUDOS_DIR, 'assinado');
const LOGO_PATH = path.join(__dirname, '../assets/logo-png.png');
const LOGO_LAUDOFY = path.join(__dirname, '../assets/laudofy-logo.png');
const ASSINATURA_PATH = path.join(__dirname, '../assets/assinatura_sem_fundo.png');
// Criar diretórios se não existirem
try {
  [LAUDOS_DIR, LAUDOS_ASSINADOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (err) {
  console.error('Could not create directories:', err);
  process.exit(1);
}

// Função auxiliar para calcular idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const m = hoje.getMonth() - nascimento.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }
  return idade;
}

// Função base para gerar o conteúdo do PDF do laudo
async function gerarConteudoPdfLaudo(doc, laudo, exame, usuarioMedico, medicoNome, conclusao, publicLink, styles) {
  // Cabeçalho
  const addHeader = () => {
    doc.fillColor(styles.colors.primary)
      .rect(0, 0, doc.page.width, 80)
      .fill();

    if (LOGO_PATH && fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, styles.margins.left, 15, { height: 38 });
    } else {
      doc.fillColor(styles.colors.light)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('LOGO', styles.margins.left, 30);
    }

    const rightTextX = doc.page.width - styles.margins.headerRight;
    doc.fillColor(styles.colors.light)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.small)
      .text(`LAUDO #${laudo._id.toString().substring(0, 8)}`,
        rightTextX, 20, { align: 'right', width: 100 })
      .font('Helvetica')
      .text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`,
        rightTextX, 40, { align: 'right', width: 100 });
  };

  addHeader();

  // Logo de fundo
  if (LOGO_LAUDOFY && fs.existsSync(LOGO_LAUDOFY)) {
    doc.opacity(0.04);
    doc.image(LOGO_LAUDOFY, doc.page.width / 2 - 200, doc.page.height / 2 - 200, { width: 400 });
    doc.opacity(1);
  }

  // Título
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.title)
    .text(`LAUDO MÉDICO | ${exame.tipoExame || 'Exame'}`,
      styles.margins.left, 100);

  // Linha divisória
  doc.moveTo(styles.margins.left, 125)
    .lineTo(doc.page.width - styles.margins.right, 125)
    .lineWidth(1)
    .stroke(styles.colors.gray);

  // Funções auxiliares
  const formatValue = (value, suffix = '') => {
    if (value === undefined || value === null) return 'Não informado';
    return `${value}${suffix}`;
  };
  const drawLabelValue = (label, value, x, y) => {
    doc.fillColor(styles.colors.text)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.label)
      .text(label, x, y);

    doc.font('Helvetica')
      .fontSize(styles.fonts.normal)
      .text(value, x + doc.widthOfString(label) + 2, y);

    return y + 18;
  };

  // Dados do paciente e exame
  let currentY = 140;
  let pacienteY = currentY;
  pacienteY = drawLabelValue('Nome: ', exame?.paciente?.nome || 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('CPF: ', exame?.paciente?.cpf || 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Nascimento: ', exame?.paciente?.dataNascimento ?
    new Date(exame.paciente.dataNascimento).toLocaleDateString('pt-BR') : 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Idade: ', exame?.paciente?.dataNascimento ?
    calcularIdade(exame.paciente.dataNascimento) + ' anos' : 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Altura: ', formatValue(exame?.altura, ' cm'), styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Peso: ', formatValue(exame?.peso, ' kg'), styles.margins.left, pacienteY);

  let exameY = currentY;
  const column2X = doc.page.width / 2;
  exameY = drawLabelValue('Data do Exame: ', exame?.dataExame ?
    new Date(exame.dataExame).toLocaleDateString('pt-BR') : 'Não informado', column2X, exameY);
  exameY = drawLabelValue('Médico: ', medicoNome || 'Não informado', column2X, exameY);
  if (exame?.frequenciaCardiaca) {
    exameY = drawLabelValue('FC: ', formatValue(exame.frequenciaCardiaca, ' bpm'), column2X, exameY);
  }
  if (exame?.segmentoPR) {
    exameY = drawLabelValue('PR: ', formatValue(exame.segmentoPR, ' ms'), column2X, exameY);
  }
  if (exame?.duracaoQRS) {
    exameY = drawLabelValue('QRS: ', formatValue(exame.duracaoQRS, ' ms'), column2X, exameY);
  }

  currentY = Math.max(pacienteY, exameY) + styles.spacing.section;

  // Divisão antes da conclusão
  doc.moveTo(styles.margins.left, currentY)
    .lineTo(doc.page.width - styles.margins.right, currentY)
    .lineWidth(1)
    .stroke(styles.colors.gray);

  currentY += styles.spacing.section;

  // Seção de conclusão
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.section)
    .text('ANÁLISE E CONCLUSÃO', styles.margins.left, currentY);

  currentY += styles.spacing.paragraph;

  // Conclusão formatada
  const conclusaoParagrafos = conclusao?.split('\n') || ['Não informado'];
  conclusaoParagrafos.forEach(paragrafo => {
    if (paragrafo.trim().length > 0) {
      const height = doc.heightOfString(paragrafo, {
        width: doc.page.width - styles.margins.left - styles.margins.right,
        align: 'justify'
      });

      if (currentY + height > doc.page.height - 180) {
        doc.addPage();
        currentY = styles.margins.top;
        addHeader();
      }

      doc.fillColor(styles.colors.text)
        .font('Helvetica')
        .fontSize(styles.fonts.normal)
        .text(paragrafo, styles.margins.left, currentY, {
          width: doc.page.width - styles.margins.left - styles.margins.right,
          align: 'justify',
          lineGap: styles.spacing.line
        });

      currentY += height + styles.spacing.paragraph;
    }
  });

  return currentY;
}

// Função para gerar PDF assinado com assinatura PNG corretamente proporcionada
exports.gerarPdfLaudoAssinado = async (laudoId, exame, tipoExame, medicoNome, medicoId, conclusao) => {
  try {
    const laudo = await Laudo.findById(laudoId).populate('exame');
    const usuarioMedico = await Usuario.findById(medicoId).populate('crm');
    const publicLink = `${process.env.FRONTEND_URL}/publico/${laudoId}`;
    const pdfBuffers = [];
    const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true });

    doc.on('data', (chunk) => pdfBuffers.push(chunk));

    // Estilos
    const styles = {
      colors: {
        primary: '#2E3A59',
        secondary: '#4B6BFF',
        light: '#FFFFFF',
        dark: '#2E3A59',
        text: '#333333',
        gray: '#8F9BB3',
        signature: '#4B6BFF'
      },
      margins: {
        left: 40,
        right: 60,
        top: 50,
        bottom: 40,
        headerRight: 150
      },
      fonts: {
        header: 16,
        title: 14,
        section: 12,
        normal: 10,
        small: 8,
        label: 10
      },
      spacing: {
        section: 20,
        paragraph: 15,
        line: 5,
        afterImage: 20,
        imageHeight: 320
      }
    };

    // Conteúdo principal
    await gerarConteudoPdfLaudo(doc, laudo, exame, usuarioMedico, medicoNome, conclusao, publicLink, styles);

    // Rodapé com assinatura
    const rodapeY = doc.page.height - 124;
    const assinaturaLarguraMax = 120; // ainda menor
    const assinaturaX = (doc.page.width - assinaturaLarguraMax) / 2;

    // Adiciona a imagem da assinatura menor e mais para cima
    if (fs.existsSync(ASSINATURA_PATH)) {
      doc.image(
        ASSINATURA_PATH,
        assinaturaX,
        rodapeY - 80, // um pouco mais para cima, se desejar
        {
          width: assinaturaLarguraMax,
        }
      );
    }

    // Nome e CRM abaixo da assinatura
    doc.fillColor('#2E3A59')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(medicoNome || 'Dr. Médico Responsável', assinaturaX, rodapeY + 25, {
        width: assinaturaLarguraMax,
        align: 'center'
      })
      .font('Helvetica')
      .text(`CRM ${usuarioMedico?.crm || 'Crm não registrado'}`, assinaturaX, rodapeY + 40, {
        width: assinaturaLarguraMax,
        align: 'center'
      });

    // Link público abaixo da assinatura
    const publicLinkY = rodapeY + 65;
    const codigoAcesso = laudo?.codigoAcesso || 'XXXX';
    const larguraTexto = doc.page.width - styles.margins.left - styles.margins.right;

    doc.fillColor(styles.colors.dark)
      .font('Helvetica')
      .fontSize(styles.fonts.normal)
      .text(`Acesse o laudo digital em: ${publicLink}`, styles.margins.left, publicLinkY, {
        width: larguraTexto,
        align: 'center'
      });

    doc.text(`e digite o código de acesso: ${codigoAcesso}`, styles.margins.left, publicLinkY + 15, {
      width: larguraTexto,
      align: 'center'
    });

    // Finaliza PDF
    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(pdfBuffers);
          const pdfFile = {
            buffer: pdfBuffer,
            originalname: `laudo_assinado_${laudoId}.pdf`,
            mimetype: 'application/pdf',
            size: pdfBuffer.length
          };
          const uploadcareUrl = await uploadPDFToUploadcare(pdfFile);
          const updatedLaudo = await Laudo.findByIdAndUpdate(
            laudoId,
            {
              laudoAssinado: uploadcareUrl,
              status: 'Laudo assinado',
              valido: true,
              dataAssinatura: new Date()
            },
            { new: true }
          );
          resolve({ success: true, fileUrl: uploadcareUrl, laudo: updatedLaudo });
        } catch (err) {
          reject(err);
        }
      });
      doc.on('error', (err) => reject(err));
      doc.end();
    });
  } catch (err) {
    throw err;
  }
};

// --- CRIAÇÃO DO LAUDO JÁ ASSINADO ---
exports.criarLaudo = async (req, res) => {
  let novoLaudo;
  try {
    const { exameId, conclusao } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    if (!exameId || !conclusao) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo sem dados obrigatórios',
        collectionName: 'laudos',
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(400).json({ erro: 'Exame e conclusão são obrigatórios' });
    }

    const exame = await Exame.findById(exameId)
      .populate('paciente')
      .populate('tipoExame');

    if (!exame) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo para exame inexistente',
        collectionName: 'laudos',
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(404).json({ erro: 'Exame não encontrado' });
    }

    const laudoExistente = await Laudo.findOne({ exame: exameId, valido: true });
    if (laudoExistente) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo duplicado para exame',
        collectionName: 'laudos',
        documentId: laudoExistente._id,
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(400).json({ erro: 'Já existe um laudo válido para este exame' });
    }
    const gerarCodigoAcesso = () => Math.floor(1000 + Math.random() * 9000).toString();
    const codigoAcesso = gerarCodigoAcesso();

    // Cria o laudo já assinado
    novoLaudo = new Laudo({
      exame: exameId,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao,
      status: 'Laudo assinado',
      valido: true,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      codigoAcesso
    });

    await novoLaudo.save();

    exame.status = 'Laudo realizado';
    exame.laudo = novoLaudo._id;
    await exame.save();

    await AuditLog.create({
      userId: usuarioId,
      action: 'create',
      description: `Novo laudo criado para exame ${exameId}`,
      collectionName: 'laudos',
      documentId: novoLaudo._id,
      before: null,
      after: novoLaudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: exame.paciente._id,
        tipoExame: exame.tipoExame.nome
      }
    });

    // Gera o PDF assinado (com assinatura PNG)
    const resultado = await exports.gerarPdfLaudoAssinado(
      novoLaudo._id,
      exame,
      exame.tipoExame,
      usuarioNome,
      usuarioId,
      conclusao
    );

    novoLaudo.laudoAssinado = resultado.fileUrl;
    novoLaudo.dataAssinatura = new Date();
    await novoLaudo.save();

    res.status(201).json({
      mensagem: 'Laudo criado e assinado com sucesso',
      laudo: {
        id: novoLaudo._id,
        exame: exameId,
        status: novoLaudo.status,
        criadoEm: novoLaudo.createdAt,
        laudoAssinado: novoLaudo.laudoAssinado
      },
      valido: true
    });

  } catch (err) {
    logger.error('Erro ao criar laudo:', err);

    if (novoLaudo?._id) {
      await Laudo.findByIdAndUpdate(novoLaudo._id, {
        status: 'Erro ao gerar PDF'
      });
    }

    await AuditLog.create({
      userId: req.user?._id,
      action: 'create',
      description: 'Falha ao criar laudo',
      collectionName: 'laudos',
      status: 'failed',
      error: err.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({
      erro: 'Erro ao criar laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// --- REFAZER LAUDO ---
exports.refazerLaudo = async (req, res) => {
  let novoLaudo;
  try {
    const laudoId = req.params.id;
    const { conclusao } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    // Busca o laudo original
    const laudoOriginal = await Laudo.findById(laudoId).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });

    if (!laudoOriginal) {
      return res.status(404).json({ erro: 'Laudo original não encontrado' });
    }

    // Cria novo laudo (nova versão)
    const gerarCodigoAcesso = () => Math.floor(1000 + Math.random() * 9000).toString();
    const codigoAcesso = gerarCodigoAcesso();

    novoLaudo = new Laudo({
      exame: laudoOriginal.exame._id,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao: conclusao || laudoOriginal.conclusao,
      status: 'Laudo assinado',
      valido: true,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      codigoAcesso,
      historico: [
        ...(laudoOriginal.historico || []),
        {
          data: new Date(),
          usuario: usuarioId,
          nomeUsuario: usuarioNome,
          acao: 'Refação',
          detalhes: 'Laudo refeito',
          versao: (laudoOriginal.historico?.length || 0) + 1
        }
      ]
    });

    await novoLaudo.save();

    // Atualiza exame para apontar para o novo laudo
    laudoOriginal.exame.laudo = novoLaudo._id;
    laudoOriginal.exame.status = 'Laudo realizado';
    await laudoOriginal.exame.save();

    // Auditoria
    await AuditLog.create({
      userId: usuarioId,
      action: 'recreate',
      description: `Laudo refeito para exame ${laudoOriginal.exame._id}`,
      collectionName: 'laudos',
      documentId: novoLaudo._id,
      before: laudoOriginal.toObject(),
      after: novoLaudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: laudoOriginal.exame.paciente._id,
        tipoExame: laudoOriginal.exame.tipoExame.nome
      }
    });

    // Gera o PDF assinado (com assinatura PNG)
    const resultado = await exports.gerarPdfLaudoAssinado(
      novoLaudo._id,
      laudoOriginal.exame,
      laudoOriginal.exame.tipoExame,
      usuarioNome,
      usuarioId,
      novoLaudo.conclusao
    );

    novoLaudo.laudoAssinado = resultado.fileUrl;
    novoLaudo.dataAssinatura = new Date();
    await novoLaudo.save();

    res.status(201).json({
      mensagem: 'Laudo refeito e assinado com sucesso',
      laudo: {
        id: novoLaudo._id,
        exame: laudoOriginal.exame._id,
        status: novoLaudo.status,
        criadoEm: novoLaudo.createdAt,
        laudoAssinado: novoLaudo.laudoAssinado
      },
      valido: true
    });

  } catch (err) {
    logger.error('Erro ao refazer laudo:', err);

    if (novoLaudo?._id) {
      await Laudo.findByIdAndUpdate(novoLaudo._id, {
        status: 'Erro ao gerar PDF'
      });
    }

    await AuditLog.create({
      userId: req.user?._id,
      action: 'recreate',
      description: 'Falha ao refazer laudo',
      collectionName: 'laudos',
      status: 'failed',
      error: err.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({
      erro: 'Erro ao refazer laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Listar laudos por paciente
exports.listarLaudosPorPaciente = async (req, res) => {
  try {
    const pacienteId = req.params.id;
    const laudos = await Laudo.find({ 'exame.paciente': pacienteId }).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });
    res.json(laudos);
  } catch (err) {
    logger.error('Erro ao listar laudos por paciente:', err);
    res.status(500).json({ erro: 'Erro ao listar laudos por paciente' });
  }
};

// Listar todos os laudos
exports.listarLaudos = async (req, res) => {
  try {
    const { exame, medicoResponsavel, status, valido, page = 1, limit = 10, pacienteId } = req.query;

    const filtro = {};
    
    // Filtro principal: apenas laudos do paciente específico
    if (pacienteId) {
      filtro['exame.paciente'] = pacienteId;
    }
    
    // Filtros adicionais
    if (exame) filtro.exame = exame;
    if (medicoResponsavel) filtro.medicoResponsavel = new RegExp(medicoResponsavel, 'i');
    if (status) filtro.status = status;
    if (valido !== undefined) filtro.valido = valido === 'true';

    const pagina = parseInt(page);
    const limite = parseInt(limit);

    const laudos = await Laudo.find(filtro)
        .populate({
          path: 'exame',
          populate: {
              path: 'paciente',
              select: 'nome'
          }
        })
        .sort({ createdAt: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite);

    const totalLaudos = await Laudo.countDocuments(filtro);

    res.status(200).json({
        laudos,
        paginaAtual: pagina,
        totalPaginas: Math.ceil(totalLaudos / limite),
        totalLaudos,
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};


// Obter um laudo por ID
exports.obterLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id)
      .populate('exame')
      .populate('laudoAnterior', 'id valido versao status')
      .populate('laudoSubstituto', 'id valido versao status');
    
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Adiciona informações sobre a validade do laudo
    const laudoComValidade = {
      ...laudo.toObject(),
      cadeiaValidade: {
        atual: {
          id: laudo._id,
          valido: laudo.valido,
          versao: laudo.versao
        },
        anterior: laudo.laudoAnterior ? {
          id: laudo.laudoAnterior._id,
          valido: laudo.laudoAnterior.valido,
          versao: laudo.laudoAnterior.versao,
          status: laudo.laudoAnterior.status
        } : null,
        substituto: laudo.laudoSubstituto ? {
          id: laudo.laudoSubstituto._id,
          valido: laudo.laudoSubstituto.valido,
          versao: laudo.laudoSubstituto.versao,
          status: laudo.laudoSubstituto.status
        } : null
      }
    };

    res.status(200).json(laudoComValidade);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};

// Histórico de versões do laudo
exports.getHistoricoLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    res.json(laudo.historico || []);
  } catch (err) {
    logger.error('Erro ao obter histórico do laudo:', err);
    res.status(500).json({ erro: 'Erro ao obter histórico do laudo' });
  }
};

// Gerar PDF do laudo (original, sem assinatura)
exports.gerarPdfLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    // Gere o PDF como no gerarConteudoPdfLaudo, mas sem assinatura
    // ...implemente conforme sua lógica...
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao gerar PDF do laudo:', err);
    res.status(500).json({ erro: 'Erro ao gerar PDF do laudo' });
  }
};

// Download do laudo original
exports.downloadLaudoOriginal = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo || !laudo.laudoOriginal) {
      return res.status(404).json({ erro: 'Arquivo original não encontrado' });
    }
    // Implemente o envio do arquivo conforme seu armazenamento
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao baixar laudo original:', err);
    res.status(500).json({ erro: 'Erro ao baixar laudo original' });
  }
};

// Download do laudo assinado
exports.downloadLaudoAssinado = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo || !laudo.laudoAssinado) {
      return res.status(404).json({ erro: 'Arquivo assinado não encontrado' });
    }
    // Implemente o envio do arquivo conforme seu armazenamento
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao baixar laudo assinado:', err);
    res.status(500).json({ erro: 'Erro ao baixar laudo assinado' });
  }
};

// Estatísticas de laudos
exports.getEstatisticas = async (req, res) => {
  try {
    const total = await Laudo.countDocuments();
    const assinados = await Laudo.countDocuments({ status: 'Laudo assinado' });
    res.json({ total, assinados });
  } catch (err) {
    logger.error('Erro ao obter estatísticas:', err);
    res.status(500).json({ erro: 'Erro ao obter estatísticas' });
  }
};

// Relatório de laudos por status
exports.getLaudosPorStatus = async (req, res) => {
  try {
    const stats = await Laudo.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    res.json(stats);
  } catch (err) {
    logger.error('Erro ao obter relatório por status:', err);
    res.status(500).json({ erro: 'Erro ao obter relatório por status' });
  }
};

// Listar laudos por exame
exports.getLaudosPorExame = async (req, res) => {
  try {
    const exameId = req.params.id;
    const laudos = await Laudo.find({ exame: exameId });
    res.json(laudos);
  } catch (err) {
    logger.error('Erro ao listar laudos por exame:', err);
    res.status(500).json({ erro: 'Erro ao listar laudos por exame' });
  }
};

// Enviar laudo por e-mail
exports.enviarEmailLaudo = async (req, res) => {
  try {
    // Implemente conforme sua lógica de envio de e-mail
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao enviar laudo por e-mail:', err);
    res.status(500).json({ erro: 'Erro ao enviar laudo por e-mail' });
  }
};

// Visualizar laudo público
exports.visualizarLaudoPublico = async (req, res) => {
  try {
    // Implemente conforme sua lógica de visualização pública
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao visualizar laudo público:', err);
    res.status(500).json({ erro: 'Erro ao visualizar laudo público' });
  }
};

// Autenticar laudo público
exports.autenticarLaudoPublico = async (req, res) => {
  try {
    // Implemente conforme sua lógica de autenticação pública
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao autenticar laudo público:', err);
    res.status(500).json({ erro: 'Erro ao autenticar laudo público' });
  }
};

// Invalidar laudo
exports.invalidarLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findByIdAndUpdate(
      req.params.id,
      { valido: false, status: 'Invalidado' },
      { new: true }
    );
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    res.json({ mensagem: 'Laudo invalidado com sucesso', laudo });
  } catch (err) {
    logger.error('Erro ao invalidar laudo:', err);
    res.status(500).json({ erro: 'Erro ao invalidar laudo' });
  }
};

// Gerar relatório (exemplo)
exports.gerarRelatorio = async (req, res) => {
  try {
    // Implemente conforme sua lógica de relatório
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao gerar relatório:', err);
    res.status(500).json({ erro: 'Erro ao gerar relatório' });
  }
};

// Exportar relatório em PDF (exemplo)
exports.relatorioPdf = async (req, res) => {
  try {
    // Implemente conforme sua lógica de exportação PDF
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao exportar relatório PDF:', err);
    res.status(500).json({ erro: 'Erro ao exportar relatório PDF' });
  }
};