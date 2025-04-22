const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const HistoricoSchema = new mongoose.Schema({
  data: {
    type: Date,
    default: Date.now
  },
  usuario: {
    type: String,
    required: false,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  nomeUsuario: {
    type: String,
    required: false,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  acao: {
    type: String,
    required: true,
    enum: [
      'Criação',
      'Atualização', 
      'Assinatura',
      'EnvioEmail',
      'Refação',
      'Cancelamento',
      'ErroEnvio',
      'TransacaoFinanceira'
    ]
  },
  detalhes: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  versao: {
    type: Number
  },
  destinatarioEmail: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  statusEnvio: {
    type: String,
    enum: ['Pendente', 'Enviado', 'Falha']
  },
  mensagemErro: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  }
}, { _id: false });

const LaudoSchema = new mongoose.Schema({
  exame: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exame',
    required: true
  },
  medicoResponsavel: {
    type: String,
    required: true,
    set: v => encrypt(v.trim()),
    get: v => decrypt(v)
  },
  medicoResponsavelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  conclusao: {
    type: String,
    required: true,
    set: v => encrypt(v.trim()),
    get: v => decrypt(v)
  },
  laudoOriginal: {
    type: String,
    default: '',
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  laudoAssinado: {
    type: String,
    default: '',
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  status: {
    type: String,
    enum: [
      'Rascunho',
      'Laudo em processamento', 
      'Laudo realizado', 
      'Laudo assinado',
      'Laudo refeito',
      'Cancelado',
      'Erro ao gerar PDF',
      'Erro no envio'
    ],
    default: 'Rascunho'
  },
  valido: {
    type: Boolean,
    default: true,
    index: true
  },
  versao: {
    type: Number,
    default: 1
  },
  laudoAnterior: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo'
  },
  laudoSubstituto: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo'
  },
  motivoRefacao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  motivoSubstituicao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  historico: [HistoricoSchema],
  criadoPor: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  criadoPorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  },
  atualizadoPor: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  atualizadoPorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  },
  dataAssinatura: {
    type: Date
  },
  dataEnvioEmail: {
    type: Date
  },
  destinatarioEmail: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  ehVersaoAtual: {
    type: Boolean,
    default: true
  },
  publicLink: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  codigoAcesso: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  }  
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    getters: true,
    transform: function(doc, ret) {
      // Garante que os getters sejam aplicados corretamente
      const fieldsToDecrypt = [
        'medicoResponsavel', 'conclusao', 'laudoOriginal', 'laudoAssinado',
        'motivoRefacao', 'motivoSubstituicao', 'criadoPor', 'atualizadoPor',
        'destinatarioEmail', 'publicLink'
      ];
      
      fieldsToDecrypt.forEach(field => {
        if (ret[field]) ret[field] = doc[field];
      });
      
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    getters: true 
  }
});

// Virtuals para relacionamentos (mantidos iguais)
LaudoSchema.virtual('laudosSubsequentes', {
  ref: 'Laudo',
  localField: '_id',
  foreignField: 'laudoAnterior',
  justOne: false
});

LaudoSchema.virtual('paciente', {
  ref: 'Exame',
  localField: 'exame',
  foreignField: '_id',
  justOne: true
});

// Middlewares (atualizados para lidar com campos criptografados)
LaudoSchema.pre('save', function(next) {
  if (this.isNew) {
    this.historico.push({
      usuario: this.criadoPor,
      nomeUsuario: decrypt(this.criadoPor) || this.criadoPor,
      acao: 'Criação',
      detalhes: `Versão ${this.versao} criada`,
      versao: this.versao
    });
  } else if (this.isModified()) {
    this.historico.push({
      usuario: this.atualizadoPor || this.criadoPor,
      nomeUsuario: decrypt(this.atualizadoPor) || decrypt(this.criadoPor) || (this.atualizadoPor || this.criadoPor),
      acao: 'Atualização',
      detalhes: `Alterações na versão ${this.versao}`,
      versao: this.versao
    });
  }
  next();
});

// Métodos atualizados para lidar com campos criptografados
LaudoSchema.methods.registrarEnvioEmail = async function(usuario, nomeUsuario, destinatario, status, mensagemErro = null) {
  this.dataEnvioEmail = new Date();
  this.destinatarioEmail = destinatario;

  this.historico.push({
    usuario: encrypt(usuario.trim()),
    nomeUsuario: encrypt(nomeUsuario.trim()),
    acao: 'EnvioEmail',
    detalhes: mensagemErro ? encrypt(mensagemErro.trim()) : encrypt(`Laudo enviado para ${destinatario}`.trim()),
    versao: this.versao,
    destinatarioEmail: encrypt(destinatario.trim()),
    statusEnvio: status,
    mensagemErro: mensagemErro ? encrypt(mensagemErro.trim()) : null
  });

  await this.save();
};

LaudoSchema.methods.registrarAssinatura = async function(usuario, nomeUsuario, usuarioId) {
  this.status = 'Laudo assinado';
  this.dataAssinatura = new Date();
  this.atualizadoPor = encrypt(usuario.trim());
  this.atualizadoPorId = usuarioId;
  
  this.historico.push({
    usuario: encrypt(usuario.trim()),
    nomeUsuario: encrypt(nomeUsuario.trim()),
    acao: 'Assinatura',
    detalhes: encrypt(`Laudo assinado digitalmente`.trim()),
    versao: this.versao
  });

  await this.save();
};

// Índices (mantidos iguais)
LaudoSchema.index({ status: 1 });
LaudoSchema.index({ exame: 1 });
LaudoSchema.index({ 'historico.data': -1 });
LaudoSchema.index({ dataAssinatura: -1 });
LaudoSchema.index({ medicoResponsavelId: 1 });

module.exports = mongoose.model('Laudo', LaudoSchema);