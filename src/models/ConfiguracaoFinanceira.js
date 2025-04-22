// models/ConfiguracaoFinanceira.js
const mongoose = require('mongoose');

const ValorPorTipoSchema = new mongoose.Schema({
  tipoExame: {
    type: String,
    required: true
  },
  valor: {
    type: Number,
    required: true,
    min: 0
  }
});

const ConfiguracaoFinanceiraSchema = new mongoose.Schema({
  medico: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  valoresPorTipo: [ValorPorTipoSchema],
  comissao: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 30
  },
  ativo: {
    type: Boolean,
    default: true
  },
  criadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  dataInicioVigencia: {
    type: Date,
    default: Date.now
  },
  dataFimVigencia: Date
}, { timestamps: true });

module.exports = mongoose.model('ConfiguracaoFinanceira', ConfiguracaoFinanceiraSchema);